/**
 * Concrete port implementations for the SignedAdminMutation middleware
 * (F4.13 / Hard Law #10).
 *
 * The middleware file defines three port interfaces — server signer,
 * verifier, nonce store — and provides an in-memory nonce store. The
 * server signer and verifier intentionally have no class in the
 * middleware file: their key-loading and crypto live behind the
 * composition root so dev/prod/test wiring can swap them. This module
 * provides the two reference implementations that:
 *
 *   - load admin keypairs from `keys/admins/<principalId>.keypair.json`
 *     (server signer) and the matching `.public.json` (verifier)
 *   - canonicalize the envelope body (mutationKind, payload, opener,
 *     issuedAt, nonce) exactly the same way on sign and verify
 *   - return the structured digest + signature fingerprint the
 *     middleware writes into the Run Ledger admin_mutation_intent /
 *     _committed events
 *
 * Both builders accept their key-loading dependency as a function so
 * tests can inject deterministic fixtures (and so production can swap
 * to a different on-disk layout without rewriting the port).
 *
 * Canonical body shape (must match between signer and verifier):
 *   canonicalize({
 *     mutationKind,
 *     payload,
 *     opener,
 *     issuedAt,
 *     nonce,
 *   })
 *
 * This is the same pattern the mode-manager uses for ModeConfiguration
 * signing (sign(canonicalize({ ...config without signature }))).
 */
import { createHash } from 'node:crypto';
// Layer 7 (api) is restricted to @nexus/contracts + @nexus/core per the
// seven-layer import-law gate (BOUNDARY-001 / F4.18). Both sign and verify
// re-export the same Ed25519 primitives that live in runtime-utils.
import { sign, verify, canonicalize } from '@nexus/core';
import type {
  AdminMutationKind,
  Base64Url,
  IsoTimestamp,
  NonEmpty,
  SignedAdminMutation,
} from '@nexus/contracts';
import type {
  AdminMutationServerSignerPort,
  AdminMutationVerifierPort,
  AdminMutationVerifyResult,
} from './signed-admin-mutation.js';

/**
 * Default age window: a SignedAdminMutation envelope older than this is
 * rejected as `expired_envelope`. Matches the nonce TTL inside the
 * middleware (NONCE_TTL_SECONDS = 60 * 60). Beyond this the nonce store
 * has already evicted the entry, so even a valid signature could not be
 * replay-protected — fail closed at verify time.
 */
const DEFAULT_MAX_ENVELOPE_AGE_SECONDS = 60 * 60;

interface AdminKeypair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/**
 * Compute the canonical bytes signed/verified for a SignedAdminMutation.
 * Strips the signature, canonicalizes the rest. Used by both ports.
 */
function canonicalAdminMutationBody<TPayload>(input: {
  mutationKind: AdminMutationKind;
  payload: TPayload;
  opener: NonEmpty;
  issuedAt: IsoTimestamp;
  nonce: NonEmpty;
}): string {
  return canonicalize({
    mutationKind: input.mutationKind,
    payload: input.payload,
    opener: input.opener,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
  });
}

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

function fingerprintSignature(signature: string): string {
  const h = sha256Base64Url(signature);
  return `sha256:${h.slice(0, 24)}`;
}

export interface AdminMutationServerSignerDeps {
  /**
   * Load the admin's full keypair (public + private) for server-side
   * signing. Returns `null` when no keypair exists for that principal —
   * the middleware translates that into 412 ADMIN_MUTATION_OPENER_UNKNOWN.
   */
  readonly loadAdminKeypair: (principalId: string) => Promise<AdminKeypair | null>;
}

/**
 * Build a server-side signer that loads the admin's keypair from disk
 * and signs canonical envelope bytes with Ed25519. Errors thrown carry
 * `statusCode: 412` so the middleware surfaces them as
 * `admin signing keypair missing or unreadable`.
 */
export function buildAdminMutationServerSigner(
  deps: AdminMutationServerSignerDeps
): AdminMutationServerSignerPort {
  return {
    async sign<TPayload>(args: {
      opener: NonEmpty;
      mutationKind: AdminMutationKind;
      payload: TPayload;
      issuedAt: IsoTimestamp;
      nonce: NonEmpty;
    }): Promise<SignedAdminMutation<TPayload>> {
      const kp = await deps.loadAdminKeypair(args.opener as unknown as string);
      if (!kp) {
        throw Object.assign(
          new Error(
            'admin_signing_keypair_missing: keys/admins/' +
              args.opener +
              '.keypair.json not found; the elevated admin must register a keypair before signing admin mutations'
          ),
          { statusCode: 412 }
        );
      }
      const canonicalBody = canonicalAdminMutationBody({
        mutationKind: args.mutationKind,
        payload: args.payload,
        opener: args.opener,
        issuedAt: args.issuedAt,
        nonce: args.nonce,
      });
      // `sign` (core re-export of the Ed25519 primitive) takes a KeyPair
      // record. We shape one from the loaded admin keypair; the extra
      // fields (`generatedAt`, `purpose`) are not used by the signer but
      // satisfy the structural type. Same pattern as
      // `signingCouncilServerSigner` in serve.ts.
      const signature = await sign(canonicalBody, {
        publicKey: kp.publicKey as Base64Url,
        privateKey: kp.privateKey as Base64Url,
        generatedAt: new Date().toISOString(),
        purpose: 'dev',
      });
      return {
        mutationKind: args.mutationKind,
        payload: args.payload,
        opener: args.opener,
        issuedAt: args.issuedAt,
        nonce: args.nonce,
        signature: signature,
      };
    },
  };
}

export interface AdminMutationVerifierDeps {
  /**
   * Resolve the opener's registered Ed25519 public key
   * (`keys/admins/<opener>.public.json`). Returns `null` when the opener
   * has no registered keypair — verifier returns `opener_unknown`.
   */
  readonly loadAdminPublicKey: (principalId: NonEmpty) => Promise<Base64Url | null>;
  /**
   * Maximum allowed age between `envelope.issuedAt` and now. Older
   * envelopes are rejected as `expired_envelope`. Defaults to one hour
   * to match the in-process nonce TTL.
   */
  readonly maxEnvelopeAgeSeconds?: number;
  /**
   * Overrideable clock for deterministic tests of the expiry path.
   * Defaults to `() => Date.now()`.
   */
  readonly clock?: () => number;
}

/**
 * Build the verifier. Returns a typed `AdminMutationVerifyResult` with
 * a concrete reason on failure — the middleware maps each reason to a
 * specific HTTP status + denial code (see `signed-admin-mutation.ts`
 * §VERIFY block).
 */
export function buildAdminMutationVerifier(
  deps: AdminMutationVerifierDeps
): AdminMutationVerifierPort {
  const maxAgeSeconds = deps.maxEnvelopeAgeSeconds ?? DEFAULT_MAX_ENVELOPE_AGE_SECONDS;
  const clock = deps.clock ?? (() => Date.now());
  return {
    async verify(
      envelope: SignedAdminMutation<unknown>,
      expectedKind: AdminMutationKind
    ): Promise<AdminMutationVerifyResult> {
      // ── Structural well-formedness ───────────────────────────────────
      if (
        typeof envelope !== 'object' ||
        envelope === null ||
        typeof envelope.mutationKind !== 'string' ||
        typeof envelope.opener !== 'string' ||
        typeof envelope.issuedAt !== 'string' ||
        typeof envelope.nonce !== 'string' ||
        typeof envelope.signature !== 'string' ||
        envelope.payload === undefined
      ) {
        return {
          ok: false,
          reason: 'malformed_envelope',
          detail: 'envelope missing required field(s)',
        };
      }
      // ── Kind tag must match the route ───────────────────────────────
      if (envelope.mutationKind !== expectedKind) {
        return {
          ok: false,
          reason: 'kind_mismatch',
          detail: `envelope mutationKind=${envelope.mutationKind} does not match expected=${expectedKind}`,
        };
      }
      // ── Age window ──────────────────────────────────────────────────
      const issuedAtMs = Date.parse(envelope.issuedAt);
      if (!Number.isFinite(issuedAtMs)) {
        return {
          ok: false,
          reason: 'malformed_envelope',
          detail: 'envelope.issuedAt is not a parseable ISO timestamp',
        };
      }
      const ageSeconds = Math.floor((clock() - issuedAtMs) / 1000);
      if (ageSeconds > maxAgeSeconds) {
        return {
          ok: false,
          reason: 'expired_envelope',
          detail: `envelope age ${ageSeconds}s exceeds max ${maxAgeSeconds}s`,
        };
      }
      // ── Opener key lookup ───────────────────────────────────────────
      const publicKey = await deps.loadAdminPublicKey(envelope.opener);
      if (!publicKey) {
        return {
          ok: false,
          reason: 'opener_unknown',
          detail: `no registered admin public key for opener ${envelope.opener}`,
        };
      }
      // ── Canonicalize + Ed25519 verify ───────────────────────────────
      let canonicalBody: string;
      try {
        canonicalBody = canonicalAdminMutationBody({
          mutationKind: envelope.mutationKind,
          payload: envelope.payload,
          opener: envelope.opener,
          issuedAt: envelope.issuedAt,
          nonce: envelope.nonce,
        });
      } catch (err) {
        return {
          ok: false,
          reason: 'malformed_envelope',
          detail: `canonicalize failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const signatureValid = await verify(
        canonicalBody,
        envelope.signature as Base64Url,
        publicKey
      );
      if (!signatureValid) {
        return {
          ok: false,
          reason: 'invalid_signature',
          detail: 'Ed25519 verify against opener public key returned false',
        };
      }
      const payloadDigest = sha256Base64Url(canonicalize(envelope.payload));
      const signatureRef = fingerprintSignature(envelope.signature);
      return {
        ok: true,
        opener: envelope.opener,
        payloadDigest,
        signatureRef,
      };
    },
  };
}
