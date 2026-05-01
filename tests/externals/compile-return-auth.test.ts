/**
 * Compile-Return Auth Gate Tests — AMEND-spec §12.1 EXT-15
 *
 * File: tests/externals/compile-return-auth.test.ts
 *
 * Proves:
 *   - CompileReturnDispatcher builds valid signed_callback requests
 *   - verifyCallbackAuth accepts valid signatures and rejects invalid ones
 *   - verifyArtifactSignature accepts valid signatures and rejects invalid ones
 *   - recomputeArtifactDigest produces deterministic correct digests
 *   - Rejection: invalid callback signature
 *   - Rejection: artifact digest mismatch
 *   - Rejection: artifact signature mismatch
 *   - Rejection: runId mismatch
 *   - Rejection: unknown endpoint type
 *
 * Import law: tests/ at root use relative paths for value imports.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type {
  FinalResponseArtifact,
  CompileReturnEndpointRecord,
  CompileReturnRequest,
  CompileReturnAck,
  CompileReturnTransport,
  Base64Url,
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
} from '@nexus/contracts';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import {
  signArtifact,
  verifyArtifactSignature,
} from '../../packages/core/src/compile/final-response-signer.js';
import {
  CompileReturnDispatcherImpl,
  verifyCallbackAuth,
  recomputeArtifactDigest,
} from '../../packages/core/src/compile/compile-return-dispatcher.js';

let privateKey: string;
let publicKey: string;

beforeAll(async () => {
  const key = await loadControlPlaneKey();
  privateKey = key.privateKey;
  publicKey = key.publicKey;
});

// ─── Test Fixtures ───

function mockEndpoint(
  overrides?: Partial<CompileReturnEndpointRecord>
): CompileReturnEndpointRecord {
  return {
    returnEndpointId: 'test-return-01' as NonEmpty,
    endpointType: 'http_callback',
    enabled: true,
    targetWorkspaceSocketId: 'workspace-01' as NonEmpty,
    url: 'http://localhost:7701/compile-return/test-return-01' as NonEmpty,
    auth: {
      kind: 'signed_callback',
      keyId: 'nexus-control-plane' as NonEmpty,
    },
    acceptedArtifactTypes: ['final_response.v1' as NonEmpty],
    configuration: {},
    ...overrides,
  };
}

async function mockArtifact(
  overrides?: Partial<Omit<FinalResponseArtifact, 'signature'>>
): Promise<FinalResponseArtifact> {
  const base: Omit<FinalResponseArtifact, 'signature'> = {
    artifactId: 'aaaaaaaa-1111-4111-b111-aaaaaaaaaaaa' as Uuid,
    runId: 'bbbbbbbb-2222-4222-b222-bbbbbbbbbbbb' as Uuid,
    compilerSocketId: 'deterministic-ref-01' as NonEmpty,
    compilerActorId: null,
    compileMode: 'deterministic_render',
    bodyRef: 'file://runs/compile/test/artifact.txt' as NonEmpty,
    bodyDigest: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as Sha256Hex,
    outputClassifications: [],
    sourceMailboxItems: [],
    evidenceRefs: [],
    routingTrailRefs: [],
    runLedgerRefs: [],
    createdAt: '2026-04-30T12:00:00.000Z' as IsoTimestamp,
    ...overrides,
  };
  const signature = await signArtifact(base, privateKey);
  return { ...base, signature };
}

/** Capture transport: stores the request for later inspection. */
function captureTransport(): {
  transport: CompileReturnTransport;
  captured: () => CompileReturnRequest | null;
} {
  let capturedRequest: CompileReturnRequest | null = null;
  const transport: CompileReturnTransport = {
    endpointType: 'http_callback' as NonEmpty,
    transportVersion: '1.0.0' as NonEmpty,
    send: async (
      _endpoint: CompileReturnEndpointRecord,
      request: CompileReturnRequest
    ): Promise<CompileReturnAck> => {
      capturedRequest = request;
      return {
        runId: request.runId,
        returnEndpointId: request.returnEndpointId,
        accepted: true,
        acceptedAt: '2026-04-30T12:00:01.000Z' as IsoTimestamp,
        reason: null,
      };
    },
  };
  return { transport, captured: () => capturedRequest };
}

// ─── Dispatcher Tests ───

describe('CompileReturnDispatcherImpl', () => {
  it('builds and sends a valid CompileReturnRequest', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: (t: string) => (t === 'http_callback' ? transport : null),
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();
    const sentAt = '2026-04-30T12:00:00.500Z' as IsoTimestamp;

    const ack = await dispatcher.dispatch({
      runId: artifact.runId,
      endpoint,
      artifact,
      sentAt,
    });

    expect(ack.accepted).toBe(true);
    expect(ack.runId).toBe(artifact.runId);

    const request = captured();
    expect(request).not.toBeNull();
    expect(request!.runId).toBe(artifact.runId);
    expect(request!.returnEndpointId).toBe(endpoint.returnEndpointId);
    expect(request!.targetWorkspaceSocketId).toBe(endpoint.targetWorkspaceSocketId);
    expect(request!.auth.kind).toBe('signed_callback');
    expect(request!.auth.keyId).toBe('nexus-control-plane');
    expect(request!.sentAt).toBe(sentAt);
  });

  it('throws when no transport is registered for endpoint type', async () => {
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => null,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();

    await expect(
      dispatcher.dispatch({
        runId: artifact.runId,
        endpoint,
        artifact,
        sentAt: '2026-04-30T12:00:00.500Z' as IsoTimestamp,
      })
    ).rejects.toThrow('No CompileReturnTransport registered');
  });
});

// ─── Artifact Digest Tests ───

describe('recomputeArtifactDigest', () => {
  it('produces a deterministic hex digest', async () => {
    const artifact = await mockArtifact();
    const d1 = recomputeArtifactDigest(artifact);
    const d2 = recomputeArtifactDigest(artifact);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when artifact content changes', async () => {
    const a1 = await mockArtifact();
    const a2 = await mockArtifact({
      bodyDigest: '1111111111111111111111111111111111111111111111111111111111111111' as Sha256Hex,
    });
    expect(recomputeArtifactDigest(a1)).not.toBe(recomputeArtifactDigest(a2));
  });

  it('is independent of the signature field', async () => {
    const artifact = await mockArtifact();
    const tampered = { ...artifact, signature: 'AAAA' as Base64Url };
    // Digest is computed without signature, so it should be the same
    expect(recomputeArtifactDigest(artifact)).toBe(recomputeArtifactDigest(tampered));
  });
});

// ─── Callback Auth Verification Tests ───

describe('verifyCallbackAuth', () => {
  it('accepts a valid callback signature from the dispatcher', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => transport,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();
    await dispatcher.dispatch({
      runId: artifact.runId,
      endpoint,
      artifact,
      sentAt: '2026-04-30T12:00:00.500Z' as IsoTimestamp,
    });

    const request = captured()!;
    const valid = await verifyCallbackAuth(request, publicKey);
    expect(valid).toBe(true);
  });

  it('rejects a tampered callback signature', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => transport,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();
    await dispatcher.dispatch({
      runId: artifact.runId,
      endpoint,
      artifact,
      sentAt: '2026-04-30T12:00:00.500Z' as IsoTimestamp,
    });

    const request = captured()!;
    const tampered: CompileReturnRequest = {
      ...request,
      auth: { ...request.auth, signature: 'AABBCCDD' as Base64Url },
    };
    const valid = await verifyCallbackAuth(tampered, publicKey);
    expect(valid).toBe(false);
  });

  it('rejects when request fields are tampered (runId changed)', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => transport,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();
    await dispatcher.dispatch({
      runId: artifact.runId,
      endpoint,
      artifact,
      sentAt: '2026-04-30T12:00:00.500Z' as IsoTimestamp,
    });

    const request = captured()!;
    const tampered: CompileReturnRequest = {
      ...request,
      runId: 'cccccccc-3333-4333-b333-cccccccccccc' as Uuid,
    };
    const valid = await verifyCallbackAuth(tampered, publicKey);
    expect(valid).toBe(false);
  });

  it('rejects when verified against wrong public key', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => transport,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const artifact = await mockArtifact();
    const endpoint = mockEndpoint();
    await dispatcher.dispatch({
      runId: artifact.runId,
      endpoint,
      artifact,
      sentAt: '2026-04-30T12:00:00.500Z' as IsoTimestamp,
    });

    const request = captured()!;
    // Use a fake 32-byte key (all zeros) to test wrong-key rejection
    const fakePublicKey = Buffer.alloc(32, 0).toString('base64url');
    const valid = await verifyCallbackAuth(request, fakePublicKey);
    expect(valid).toBe(false);
  });
});

// ─── Artifact Signature Verification Tests ───

describe('verifyArtifactSignature', () => {
  it('accepts a valid artifact signature', async () => {
    const artifact = await mockArtifact();
    const valid = await verifyArtifactSignature(artifact, publicKey);
    expect(valid).toBe(true);
  });

  it('rejects a tampered artifact signature', async () => {
    const artifact = await mockArtifact();
    const tampered = { ...artifact, signature: 'ZZZZZZZ' as Base64Url };
    const valid = await verifyArtifactSignature(tampered, publicKey);
    expect(valid).toBe(false);
  });

  it('rejects when artifact content is tampered', async () => {
    const artifact = await mockArtifact();
    const tampered = {
      ...artifact,
      bodyDigest: '0000000000000000000000000000000000000000000000000000000000000000' as Sha256Hex,
    };
    const valid = await verifyArtifactSignature(tampered, publicKey);
    expect(valid).toBe(false);
  });

  it('rejects when verified against wrong public key', async () => {
    const artifact = await mockArtifact();
    const fakePublicKey = Buffer.alloc(32, 1).toString('base64url');
    const valid = await verifyArtifactSignature(artifact, fakePublicKey);
    expect(valid).toBe(false);
  });
});

// ─── Round-Trip Integration Test ───

describe('compile-return round-trip', () => {
  it('dispatcher output passes all receiver verification checks', async () => {
    const { transport, captured } = captureTransport();
    const dispatcher = new CompileReturnDispatcherImpl({
      resolveTransport: () => transport,
      signingPrivateKey: privateKey,
      keyId: 'nexus-control-plane' as NonEmpty,
    });

    const runId = 'dddddddd-4444-4444-b444-dddddddddddd' as Uuid;
    const artifact = await mockArtifact({ runId });
    const endpoint = mockEndpoint();
    const sentAt = '2026-04-30T12:00:00.500Z' as IsoTimestamp;

    await dispatcher.dispatch({ runId, endpoint, artifact, sentAt });
    const request = captured()!;

    // All verification steps per §6.9:
    // 1. returnEndpointId matches endpoint
    expect(request.returnEndpointId).toBe(endpoint.returnEndpointId);

    // 2. targetWorkspaceSocketId matches endpoint config
    expect(request.targetWorkspaceSocketId).toBe(endpoint.targetWorkspaceSocketId);

    // 3. signed_callback envelope verifies
    const callbackValid = await verifyCallbackAuth(request, publicKey);
    expect(callbackValid).toBe(true);

    // 4. artifactDigest matches recomputation
    const recomputed = recomputeArtifactDigest(request.artifact);
    expect(request.artifactDigest).toBe(recomputed);

    // 5. artifact signature verifies
    const artifactValid = await verifyArtifactSignature(request.artifact, publicKey);
    expect(artifactValid).toBe(true);

    // 6. artifact.runId matches request.runId
    expect(request.artifact.runId).toBe(request.runId);

    // 7. acceptedArtifactTypes (checked at route level, not here)
    expect(endpoint.acceptedArtifactTypes).toContain('final_response.v1');
  });
});
