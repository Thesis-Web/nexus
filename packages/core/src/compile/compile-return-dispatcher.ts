/**
 * Compile-Return Dispatcher — AMEND-spec §3.10, §6.9
 *
 * File: packages/core/src/compile/compile-return-dispatcher.ts
 * Layer 1 — baked infrastructure. NOT a replaceable plugin.
 *
 * Builds signed compile-return requests and dispatches through configured
 * CompileReturnTransport. Does NOT mark mailbox items consumed — that happens
 * after acceptance or durable signed handoff acknowledgement.
 *
 * Dispatcher law (§3.10):
 * - Takes CompileReturnDispatchInput with resolved endpoint, artifact, sentAt.
 * - Computes artifactDigest = sha256(canonicalize(artifact without signature)).
 * - Builds CompileReturnRequest with signed_callback auth.
 * - Signs callback payload with ed25519 using configured return signing key.
 * - Sends through CompileReturnTransport resolved by endpoint.endpointType.
 * - Returns CompileReturnAck from transport.
 * - Must NOT mark mailbox items consumed.
 * - Must NOT call LLMs, NXS gates, NVG routing, connectors, or approval channels.
 */
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '@nexus/runtime-utils';
import type {
  Uuid,
  IsoTimestamp,
  Sha256Hex,
  Base64Url,
  NonEmpty,
  CompileReturnEndpointRecord,
  FinalResponseArtifact,
  CompileReturnRequest,
  CompileReturnAuthEnvelope,
  CompileReturnAck,
  CompileReturnTransport,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { sha256Hex } from '../output/output-digest.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed25519.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

// ─── CompileReturnDispatchInput — §3.10 ───

export interface CompileReturnDispatchInput {
  runId: Uuid;
  endpoint: CompileReturnEndpointRecord;
  artifact: FinalResponseArtifact;
  sentAt: IsoTimestamp;
}

// ─── CompileReturnDispatcher — §3.10 ───

export interface CompileReturnDispatcher {
  dispatch(input: CompileReturnDispatchInput): Promise<CompileReturnAck>;
}

// ─── Dependencies ───

export interface CompileReturnDispatcherDeps {
  /** Resolve transport by endpoint type. V1 required: http_callback. */
  resolveTransport: (endpointType: string) => CompileReturnTransport | null;
  /** Ed25519 private key (base64url) for signing compile-return auth envelopes. */
  signingPrivateKey: string;
  /** Key identifier for the auth envelope. */
  keyId: NonEmpty;
}

// ─── Helpers (exported for verification use) ───

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Recompute artifact digest — §3.10, §8.4
 * artifactDigest = sha256(canonicalize(FinalResponseArtifact without signature))
 */
export function recomputeArtifactDigest(artifact: FinalResponseArtifact): Sha256Hex {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _sig, ...rest } = artifact;
  return sha256Hex(canonicalize(rest)) as Sha256Hex;
}

/**
 * Verify compile-return callback auth signature — §3.10 workspace verification law.
 *
 * Reconstructs the canonical signature payload from request fields and verifies
 * the ed25519 signature against the provided public key.
 */
export async function verifyCallbackAuth(
  request: CompileReturnRequest,
  publicKey: string
): Promise<boolean> {
  const payload = canonicalize({
    runId: request.runId,
    returnEndpointId: request.returnEndpointId,
    targetWorkspaceSocketId: request.targetWorkspaceSocketId,
    artifactDigest: request.artifactDigest,
    sentAt: request.sentAt,
    signedAt: request.auth.signedAt,
    keyId: request.auth.keyId,
  });

  const msgBytes = new TextEncoder().encode(payload);
  const sigBytes = new Uint8Array(Buffer.from(request.auth.signature, 'base64url'));
  const pubBytes = new Uint8Array(Buffer.from(publicKey, 'base64url'));

  try {
    return await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

// ─── Implementation ───

export class CompileReturnDispatcherImpl implements CompileReturnDispatcher {
  private readonly deps: CompileReturnDispatcherDeps;

  constructor(deps: CompileReturnDispatcherDeps) {
    this.deps = deps;
  }

  async dispatch(input: CompileReturnDispatchInput): Promise<CompileReturnAck> {
    const { runId, endpoint, artifact, sentAt } = input;

    // 1. Compute artifact digest (§3.10)
    const artifactDigest = recomputeArtifactDigest(artifact);

    // 2. Build auth envelope (§3.10 signed_callback law)
    const signedAt = nowIso();
    const signaturePayload = canonicalize({
      runId,
      returnEndpointId: endpoint.returnEndpointId,
      targetWorkspaceSocketId: endpoint.targetWorkspaceSocketId,
      artifactDigest,
      sentAt,
      signedAt,
      keyId: this.deps.keyId,
    });

    const msgBytes = new TextEncoder().encode(signaturePayload);
    const keyBytes = new Uint8Array(Buffer.from(this.deps.signingPrivateKey, 'base64url'));
    const sigBytes = await ed25519.signAsync(msgBytes, keyBytes);
    const signature = base64urlEncode(sigBytes) as Base64Url;

    const auth: CompileReturnAuthEnvelope = {
      kind: 'signed_callback',
      keyId: this.deps.keyId,
      signature,
      signedAt,
    };

    // 3. Build CompileReturnRequest (§3.10)
    const request: CompileReturnRequest = {
      runId,
      returnEndpointId: endpoint.returnEndpointId,
      targetWorkspaceSocketId: endpoint.targetWorkspaceSocketId,
      artifact,
      artifactDigest,
      sentAt,
      auth,
    };

    // 4. Resolve transport by endpoint type (§3.10, §3.15)
    const transport = this.deps.resolveTransport(endpoint.endpointType);
    if (transport === null) {
      throw new Error(
        `No CompileReturnTransport registered for endpointType '${endpoint.endpointType}'`
      );
    }

    // 5. Send through transport and return ack
    return transport.send(endpoint, request);
  }
}
