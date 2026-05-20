/**
 * SignedAdminMutation Middleware — F4.13 / Hard Law #10 (Audit + fail-closed)
 *
 * Every governance-relevant admin-writer mutation flows through this
 * higher-order wrapper:
 *
 *   1. AUTH       — checkAdminAuth (workspace JWT → admin role → elevated
 *                   session) is performed by the route caller before invoking
 *                   the wrapper, OR delegated to the wrapper's authProvider.
 *   2. ENVELOPE   — body is parsed as a SignedAdminMutation<TPayload>. UI
 *                   clients (session-authenticated) may post the plain payload
 *                   shape; the wrapper asks the server-signer port to forge an
 *                   envelope from the admin's server-side keypair. External
 *                   clients (CLI / scripts) MUST post a pre-signed envelope.
 *   3. VERIFY     — the verifier port runs canonicalize() + ed25519 verify
 *                   against the opener's registered admin public key.
 *   4. NONCE      — the nonce store rejects replays (per-process + TTL).
 *   5. LEDGER     — if no runLedgerWriter present → 503 AUDIT_UNAVAILABLE;
 *                   else write admin_mutation_intent BEFORE the mutation.
 *   6. MODE       — observe mode: log intent with wouldCommit=true and SKIP
 *                   the mutation. enforcing/advisory: apply the mutation.
 *   7. APPLY      — call the route's handler with the verified payload.
 *   8. POST-AUDIT — write admin_mutation_committed (or _failed). If the
 *                   post-write fails and storage is non-transactional, the
 *                   response is 207 with state: committed_but_audit_failed
 *                   (spec §3.2 / §4).
 *
 * The wrapper is the BAKED enforcement floor for HL #10. Plug-in admin
 * routes call into it via the curried `withAdminMutation()` helper; they
 * cannot bypass it because the routes use the wrapper's request handler
 * as their Express callback.
 *
 * Layer 7 — imports @nexus/contracts ONLY; ed25519 + canonicalize live
 * behind the verifier / signer ports (see core for reference impls).
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type {
  AdminMutationKind,
  Base64Url,
  InfraRunIdNamespace,
  IsoTimestamp,
  ModeConfiguration,
  NonEmpty,
  OperatingMode,
  RunLedgerWriter,
  SignedAdminMutation,
  Uuid,
} from '@nexus/contracts';
import { DENIAL_CODE, nowIso } from '@nexus/contracts';
import { checkAdminAuth, type AdminAuthDeps, type AdminAuthOk } from '../routes/admin-auth.js';

/**
 * Verifier port — given a SignedAdminMutation envelope, runs canonicalize +
 * ed25519 verify against the opener's registered admin public key.
 *
 * Production wires this to a closure that pulls the public key from
 * keys/admins/<opener>.keypair.json (companion .public.json) and runs
 * ed25519.verifyAsync against canonicalize(envelope.payload + kind +
 * opener + issuedAt + nonce). Tests inject a deterministic mock.
 */
export interface AdminMutationVerifyOk {
  readonly ok: true;
  readonly opener: NonEmpty;
  readonly payloadDigest: string;
  readonly signatureRef: string;
}

export interface AdminMutationVerifyFail {
  readonly ok: false;
  readonly reason:
    | 'malformed_envelope'
    | 'opener_unknown'
    | 'invalid_signature'
    | 'kind_mismatch'
    | 'expired_envelope';
  readonly detail?: string;
}

export type AdminMutationVerifyResult = AdminMutationVerifyOk | AdminMutationVerifyFail;

export interface AdminMutationVerifierPort {
  verify(
    envelope: SignedAdminMutation<unknown>,
    expectedKind: AdminMutationKind
  ): Promise<AdminMutationVerifyResult>;
}

/**
 * Nonce replay store — claim(nonce, ttlSeconds) returns true if the nonce
 * was unseen and was recorded for the TTL window; false if it had already
 * been seen and the mutation MUST be rejected as a replay (409).
 *
 * Production wires this to a per-process in-memory store with TTL eviction
 * (sufficient for admin mutations: low volume + per-process session
 * pinning). A future iteration may add a SQLite-backed variant if multi-
 * process composition becomes a requirement.
 */
export interface AdminMutationNonceStorePort {
  claim(nonce: NonEmpty, ttlSeconds: number): Promise<boolean>;
}

/**
 * Server-side signer port — for UI clients that post a plain payload (per
 * feedback_signing_keys_server_side: the browser NEVER holds the admin
 * signing key). The wrapper invokes this port to construct a real
 * SignedAdminMutation envelope from the admin's server-side keypair, then
 * proceeds through verify+ledger+apply.
 *
 * Production wires this to a closure that loads
 * keys/admins/<opener>.keypair.json and signs canonicalize(...) with the
 * admin's private key. Tests inject a mock that produces deterministic
 * fixtures.
 */
export interface AdminMutationServerSignerPort {
  sign<TPayload>(args: {
    opener: NonEmpty;
    mutationKind: AdminMutationKind;
    payload: TPayload;
    issuedAt: IsoTimestamp;
    nonce: NonEmpty;
  }): Promise<SignedAdminMutation<TPayload>>;
}

/**
 * Wrapper deps — drawn from AdminWriterRouteDeps. All five are required
 * for the wrapper to apply a mutation; the wrapper fails closed when any
 * are missing (503 with denialCode AUDIT_UNAVAILABLE, except when the
 * envelope itself is malformed which is 400).
 */
export interface AdminMutationWrapperDeps extends AdminAuthDeps {
  readonly runLedgerWriter?: RunLedgerWriter;
  readonly infraRunIdNamespace?: InfraRunIdNamespace;
  readonly adminMutationVerifier?: AdminMutationVerifierPort;
  readonly adminMutationNonceStore?: AdminMutationNonceStorePort;
  readonly adminMutationServerSigner?: AdminMutationServerSignerPort;
  /**
   * Resolves the current ModeConfiguration. When absent, the wrapper
   * defaults to enforcing (most-strict) so plug-in admin mutations cannot
   * downgrade enforcement by omitting the loader.
   */
  readonly loadModeConfig?: () => Promise<ModeConfiguration>;
  /**
   * Storage transactionality hint per spec §3.2. When the run ledger
   * backend supports rollback on post-mutation write failure, set true:
   * the wrapper will request rollback via the handler's onRollback
   * callback. When false (the default for the file-backed
   * JsonlRunLedgerWriter), post-write failure returns 207 with
   * state: 'committed_but_audit_failed' (spec §3.2).
   */
  readonly runLedgerSupportsTransactionalRollback?: boolean;
}

/** Canonical mutation envelope nonce TTL — defaults to one hour per the §3.1 replay-protection window. */
const NONCE_TTL_SECONDS = 60 * 60;

/**
 * The handler invoked once the envelope has been verified and the intent
 * event written. Receives the verified payload, the resolved opener, the
 * mutationId (shared by intent + commit/failed events), the operating
 * mode, and the auth result so the handler can attribute the mutation.
 *
 * Returns a discriminated outcome:
 *   - { kind: 'ok', result, onRollback? } — wrapper writes
 *     admin_mutation_committed and returns 200 with `data: result`.
 *   - { kind: 'failed', reason, statusCode? } — wrapper writes
 *     admin_mutation_failed and returns the specified status (default
 *     500) with `error: reason`.
 *
 * The handler MUST be synchronous-effectful: any side effects beyond
 * the return must be reflected by the time the promise resolves.
 */
/**
 * Outcome shape for an admin-mutation handler. The wrapper merges `result`
 * into the success response's `data` object alongside `mutationId` +
 * `mutationKind`. Result is intentionally typed as a plain object map so
 * routes can shape their response without re-declaring per-route generics
 * at every call site (the wrapper's runtime treats the result opaquely).
 */
export type AdminMutationHandlerOutcome =
  | {
      readonly kind: 'ok';
      readonly result: Record<string, unknown>;
      readonly onRollback?: () => Promise<void>;
    }
  | {
      readonly kind: 'failed';
      readonly reason: string;
      readonly statusCode?: number;
    };

export interface AdminMutationHandlerCtx {
  readonly mutationId: NonEmpty;
  readonly opener: NonEmpty;
  readonly nxsMode: OperatingMode;
  readonly nvgMode: OperatingMode;
  readonly auth: AdminAuthOk;
  /**
   * The raw Express Request — exposed so handlers can read path
   * parameters (`req.params.endpointId` etc.) that the parsePayload step
   * does not see. The wrapper still owns the auth + envelope path; the
   * handler MUST NOT read req.body (use the verified payload instead).
   */
  readonly req: Request;
}

export type AdminMutationHandler<TPayload> = (
  payload: TPayload,
  ctx: AdminMutationHandlerCtx
) => Promise<AdminMutationHandlerOutcome>;

/**
 * Configuration for a single wrapped mutation route.
 *
 * `mutationKind` is the AdminMutationKind discriminator that gates the
 * envelope verification (signature is computed over the canonical form
 * INCLUDING the kind, so kind tampering forces a signature mismatch).
 *
 * `parsePayload` validates the unsigned payload via Zod (or any
 * structural validator) and returns either a parsed payload or a
 * structured Bad-Request response. The wrapper handles 400 emission;
 * the handler never sees an unvalidated payload.
 */
export interface WithAdminMutationConfig<TPayload> {
  readonly mutationKind: AdminMutationKind;
  readonly parsePayload: (body: unknown) =>
    | { ok: true; data: TPayload }
    | {
        ok: false;
        status: number;
        error: string;
        details?: ReadonlyArray<{ path: string; message: string }>;
      };
  readonly handler: AdminMutationHandler<TPayload>;
}

/**
 * Higher-order route handler: returns an Express callback that runs the
 * full F4.13 pre-flight + post-flight around the supplied handler.
 *
 * Usage:
 *   app.post('/.../endpoints', withAdminMutation(deps, {
 *     mutationKind: 'manifest_entry_add',
 *     parsePayload: body => parseWithZod(EndpointCreateSchema, body),
 *     handler: async (payload, ctx) => {
 *       const result = await deps.manifestWriter.addEntry(...);
 *       return { kind: 'ok', result };
 *     },
 *   }));
 */
export function withAdminMutation<TPayload>(
  deps: AdminMutationWrapperDeps,
  config: WithAdminMutationConfig<TPayload>
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    // ── (1) AUTH ─────────────────────────────────────────────────────────
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    // ── (2) ENVELOPE PARSE ───────────────────────────────────────────────
    // Body may be either a SignedAdminMutation envelope (external clients)
    // or a plain payload shape (UI clients — server signs internally).
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    let envelope: SignedAdminMutation<unknown>;
    if (looksLikeSignedEnvelope(rawBody)) {
      envelope = rawBody as unknown as SignedAdminMutation<unknown>;
      if (envelope.mutationKind !== config.mutationKind) {
        res.status(400).json({
          ok: false,
          error: 'envelope mutationKind does not match route',
          denialCode: DENIAL_CODE.ADMIN_MUTATION_ENVELOPE_INVALID,
        });
        return;
      }
      // Parse the inner payload through the route's validator.
      const parsed = config.parsePayload(envelope.payload);
      if (!parsed.ok) {
        const errorBody: Record<string, unknown> = { ok: false, error: parsed.error };
        if (parsed.details) errorBody['details'] = parsed.details;
        res.status(parsed.status).json(errorBody);
        return;
      }
      envelope = { ...envelope, payload: parsed.data };
    } else {
      // Plain-payload path — UI session client. Parse first, then ask the
      // server signer to forge an envelope from the admin's keypair.
      const parsed = config.parsePayload(req.body);
      if (!parsed.ok) {
        const errorBody: Record<string, unknown> = { ok: false, error: parsed.error };
        if (parsed.details) errorBody['details'] = parsed.details;
        res.status(parsed.status).json(errorBody);
        return;
      }
      if (!deps.adminMutationServerSigner) {
        res.status(503).json({
          ok: false,
          error: 'admin mutation server signer not configured',
          denialCode: DENIAL_CODE.AUDIT_UNAVAILABLE,
        });
        return;
      }
      try {
        envelope = await deps.adminMutationServerSigner.sign<TPayload>({
          opener: auth.principalId as NonEmpty,
          mutationKind: config.mutationKind,
          payload: parsed.data,
          issuedAt: nowIso() as IsoTimestamp,
          nonce: createNonce(auth.principalId),
        });
      } catch (err) {
        res.status(412).json({
          ok: false,
          error: 'admin signing keypair missing or unreadable',
          detail: extractMessage(err),
          denialCode: DENIAL_CODE.ADMIN_MUTATION_OPENER_UNKNOWN,
        });
        return;
      }
    }
    // ── (3) VERIFY ───────────────────────────────────────────────────────
    if (!deps.adminMutationVerifier) {
      res.status(503).json({
        ok: false,
        error: 'admin mutation verifier not configured',
        denialCode: DENIAL_CODE.AUDIT_UNAVAILABLE,
      });
      return;
    }
    const verify = await deps.adminMutationVerifier.verify(envelope, config.mutationKind);
    if (!verify.ok) {
      const statusByReason: Record<AdminMutationVerifyFail['reason'], number> = {
        malformed_envelope: 400,
        opener_unknown: 403,
        invalid_signature: 403,
        kind_mismatch: 400,
        expired_envelope: 400,
      };
      const denialByReason: Record<AdminMutationVerifyFail['reason'], string> = {
        malformed_envelope: DENIAL_CODE.ADMIN_MUTATION_ENVELOPE_INVALID,
        opener_unknown: DENIAL_CODE.ADMIN_MUTATION_OPENER_UNKNOWN,
        invalid_signature: DENIAL_CODE.ADMIN_MUTATION_SIGNATURE_INVALID,
        kind_mismatch: DENIAL_CODE.ADMIN_MUTATION_ENVELOPE_INVALID,
        expired_envelope: DENIAL_CODE.ADMIN_MUTATION_ENVELOPE_INVALID,
      };
      res.status(statusByReason[verify.reason]).json({
        ok: false,
        error: `admin mutation envelope rejected: ${verify.reason}`,
        denialCode: denialByReason[verify.reason],
        detail: verify.detail,
      });
      return;
    }
    // Defence in depth — the verifier already validated the kind tag, but
    // also verify the opener matches the elevated session that posted it.
    if (verify.opener !== (auth.principalId as NonEmpty)) {
      res.status(403).json({
        ok: false,
        error: 'envelope opener does not match elevated session',
        denialCode: DENIAL_CODE.ADMIN_MUTATION_OPENER_UNKNOWN,
      });
      return;
    }
    // ── (4) NONCE REPLAY ─────────────────────────────────────────────────
    if (!deps.adminMutationNonceStore) {
      res.status(503).json({
        ok: false,
        error: 'admin mutation nonce store not configured',
        denialCode: DENIAL_CODE.AUDIT_UNAVAILABLE,
      });
      return;
    }
    const fresh = await deps.adminMutationNonceStore.claim(envelope.nonce, NONCE_TTL_SECONDS);
    if (!fresh) {
      res.status(409).json({
        ok: false,
        error: 'admin mutation nonce replay detected',
        denialCode: DENIAL_CODE.ADMIN_MUTATION_NONCE_REPLAY,
      });
      return;
    }
    // ── (5) LEDGER PRE-CHECK + INTENT ────────────────────────────────────
    if (!deps.runLedgerWriter || !deps.infraRunIdNamespace) {
      res.status(503).json({
        ok: false,
        error: 'run ledger unavailable — admin mutation refused (fail-closed per HL #10)',
        denialCode: DENIAL_CODE.AUDIT_UNAVAILABLE,
      });
      return;
    }
    // ── (6) MODE LOAD ────────────────────────────────────────────────────
    // Default to enforcing when no loader is wired — never relax via omission.
    let nxsMode: OperatingMode = 'enforcing';
    let nvgMode: OperatingMode = 'enforcing';
    if (deps.loadModeConfig) {
      try {
        const cfg = await deps.loadModeConfig();
        nxsMode = cfg.nxsMode;
        nvgMode = cfg.nvgMode;
      } catch {
        // Mode loader failure does NOT downgrade — keep enforcing.
      }
    }
    const mutationId = deps.infraRunIdNamespace.next();
    const runIdForInfraEvent = mutationId as unknown as Uuid;
    const payloadDigest = verify.payloadDigest;
    const signatureRef = verify.signatureRef;
    const observeOnly = nxsMode === 'observe';
    try {
      await deps.runLedgerWriter.writeEvent({
        runId: runIdForInfraEvent,
        eventType: 'admin_mutation_intent',
        timestamp: nowIso(),
        actorId: auth.actorId as Uuid,
        detail: {
          mutationKind: config.mutationKind,
          mutationId,
          opener: verify.opener,
          payloadDigest,
          signatureRef,
          principalId: auth.principalId,
          nxsMode,
          nvgMode,
          wouldCommit: observeOnly,
        },
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: 'admin_mutation_intent ledger write failed — mutation refused',
        denialCode: DENIAL_CODE.AUDIT_UNAVAILABLE,
        detail: extractMessage(err),
      });
      return;
    }
    // ── (7) APPLY (or skip in observe) ───────────────────────────────────
    if (observeOnly) {
      // Spec §3.5 observe row — signature verified, intent logged, mutation
      // NOT applied. Return 202 with an explicit observe envelope so the
      // dashboard can render the "would-commit" banner.
      res.status(202).json({
        ok: true,
        observeOnly: true,
        data: {
          mutationId,
          mutationKind: config.mutationKind,
          wouldCommit: true,
        },
      });
      return;
    }
    const verifiedPayload = envelope.payload as TPayload;
    let outcome: AdminMutationHandlerOutcome;
    try {
      outcome = await config.handler(verifiedPayload, {
        mutationId,
        opener: verify.opener,
        nxsMode,
        nvgMode,
        auth,
        req,
      });
    } catch (err) {
      await safeWriteFailed(deps, {
        runId: runIdForInfraEvent,
        mutationId,
        actorId: auth.actorId as Uuid,
        reason: extractMessage(err),
      });
      const status = extractStatus(err) ?? 500;
      res.status(status).json({ ok: false, error: extractMessage(err) });
      return;
    }
    // ── (8) POST-MUTATION AUDIT ──────────────────────────────────────────
    if (outcome.kind === 'failed') {
      await safeWriteFailed(deps, {
        runId: runIdForInfraEvent,
        mutationId,
        actorId: auth.actorId as Uuid,
        reason: outcome.reason,
      });
      res.status(outcome.statusCode ?? 500).json({ ok: false, error: outcome.reason });
      return;
    }
    try {
      await deps.runLedgerWriter.writeEvent({
        runId: runIdForInfraEvent,
        eventType: 'admin_mutation_committed',
        timestamp: nowIso(),
        actorId: auth.actorId as Uuid,
        detail: {
          mutationKind: config.mutationKind,
          mutationId,
          opener: verify.opener,
          principalId: auth.principalId,
        },
      });
    } catch (postErr) {
      // Spec §3.2: post-commit ledger failure path.
      if (deps.runLedgerSupportsTransactionalRollback && outcome.onRollback) {
        try {
          await outcome.onRollback();
        } catch (rollbackErr) {
          // If rollback itself fails, the operator faces a real audit gap —
          // surface it explicitly via the 207 path even though we asked for
          // transactional storage; the safer answer is "tell the operator".
          await safeWriteFailed(deps, {
            runId: runIdForInfraEvent,
            mutationId,
            actorId: auth.actorId as Uuid,
            reason: `rollback_failed: ${extractMessage(rollbackErr)}; original: ${extractMessage(postErr)}`,
          });
          res.status(207).json({
            ok: false,
            state: 'committed_but_audit_failed',
            data: { mutationId, mutationKind: config.mutationKind },
            error: 'rollback failed; operator remediation required',
          });
          return;
        }
        await safeWriteFailed(deps, {
          runId: runIdForInfraEvent,
          mutationId,
          actorId: auth.actorId as Uuid,
          reason: `post_commit_ledger_failure_rolled_back: ${extractMessage(postErr)}`,
        });
        res.status(500).json({
          ok: false,
          error: 'admin_mutation_committed ledger write failed; mutation rolled back',
        });
        return;
      }
      // Non-transactional storage: spec §3.2 returns 207 with explicit
      // committed_but_audit_failed state. The mutation IS applied; the audit
      // gap is operator-visible. The dashboard banner (spec §4) surfaces it.
      res.status(207).json({
        ok: true,
        state: 'committed_but_audit_failed',
        data: {
          mutationId,
          mutationKind: config.mutationKind,
          ...outcome.result,
        },
        warning: 'mutation applied but admin_mutation_committed ledger write failed',
      });
      return;
    }
    res.status(200).json({
      ok: true,
      data: {
        mutationId,
        mutationKind: config.mutationKind,
        ...outcome.result,
      },
    });
  };
}

/**
 * Per-process in-memory nonce store with TTL eviction. Sufficient for
 * single-server reference deployments; multi-process composition needs a
 * SQLite-backed variant (deferred to V2).
 */
export class InMemoryAdminMutationNonceStore implements AdminMutationNonceStorePort {
  private readonly seen = new Map<string, number>();
  private readonly clock: () => number;
  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }
  async claim(nonce: NonEmpty, ttlSeconds: number): Promise<boolean> {
    const now = this.clock();
    // Sweep expired entries on each claim — keeps the map bounded under
    // sustained admin activity.
    for (const [k, exp] of this.seen) {
      if (exp <= now) this.seen.delete(k);
    }
    if (this.seen.has(nonce as string)) return false;
    this.seen.set(nonce as string, now + ttlSeconds * 1000);
    return true;
  }
}

function looksLikeSignedEnvelope(body: Record<string, unknown>): boolean {
  return (
    typeof body['mutationKind'] === 'string' &&
    typeof body['opener'] === 'string' &&
    typeof body['issuedAt'] === 'string' &&
    typeof body['nonce'] === 'string' &&
    typeof body['signature'] === 'string' &&
    body['payload'] !== undefined
  );
}

function createNonce(seed: string): NonEmpty {
  const h = createHash('sha256');
  h.update(seed);
  h.update(String(Date.now()));
  h.update(String(Math.random()));
  return h.digest('base64url').slice(0, 32) as NonEmpty;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const sc = (err as { statusCode?: unknown }).statusCode;
    if (typeof sc === 'number' && Number.isFinite(sc)) return sc;
  }
  return undefined;
}

async function safeWriteFailed(
  deps: AdminMutationWrapperDeps,
  args: {
    runId: Uuid;
    mutationId: NonEmpty;
    actorId: Uuid;
    reason: string;
  }
): Promise<void> {
  if (!deps.runLedgerWriter) return;
  try {
    await deps.runLedgerWriter.writeEvent({
      runId: args.runId,
      eventType: 'admin_mutation_failed',
      timestamp: nowIso(),
      actorId: args.actorId,
      detail: {
        mutationId: args.mutationId,
        reason: args.reason,
      },
    });
  } catch {
    // The wrapper has already declined the mutation (or rolled it back).
    // A failed _failed write is a tertiary audit gap — operators detect
    // it via gap detection on the run-ledger.
  }
}

/**
 * Re-export the canonical envelope wire-shape compatibility hint. Routes
 * that compose multiple wrapped handlers can reference this type via
 * generics; tests can construct fixtures against it directly.
 */
export type SignedAdminMutationEnvelope<TPayload> = SignedAdminMutation<TPayload>;

export type AdminMutationSignatureFingerprint = Base64Url;
