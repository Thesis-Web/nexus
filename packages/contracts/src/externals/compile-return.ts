// packages/contracts/src/externals/compile-return.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.10, §3.15 — Compile-Return Contracts
// Layer 2 — compile-return request, auth envelope, verifier, and transport.
//
// Signed callback law:
//   signaturePayload = canonicalize({
//     runId, returnEndpointId, targetWorkspaceSocketId,
//     artifactDigest, sentAt, signedAt, keyId
//   })
//   signature = ed25519.sign(signaturePayload, configuredReturnSigningPrivateKey)
//
// Workspace verification:
//   - verify ed25519 signature using configured keyId
//   - recompute artifactDigest from canonical artifact without transport auth
//   - assert recomputed digest equals request.artifactDigest
//   - assert request.artifact.runId equals request.runId
//   - assert request.artifact.signature verifies under compiler key law
//   - reject on any failure
//
// CompileReturnTransport law:
// - Outbound wire from Nexus compile-return dispatcher to configured workspace endpoint.
// - V1 required transport is http_callback.
// - A transport must not call LLMs, NXS gates, NVG routing, connectors,
//   or approval channels.

import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty } from '../types/index.js';
import type { DenialCode } from '../constants/index.js';
import type { FinalResponseArtifact } from './compiler.js';
import type { CompileReturnEndpointRecord } from './manifests.js';

// ─── CompileReturnAuthEnvelope ───

export interface CompileReturnAuthEnvelope {
  kind: 'signed_callback';
  keyId: NonEmpty;
  signature: Base64Url;
  signedAt: IsoTimestamp;
}

// ─── CompileReturnRequest ───

export interface CompileReturnRequest {
  runId: Uuid;
  returnEndpointId: NonEmpty;
  targetWorkspaceSocketId: NonEmpty;
  artifact: FinalResponseArtifact;
  artifactDigest: Sha256Hex;
  sentAt: IsoTimestamp;
  auth: CompileReturnAuthEnvelope;
}

// ─── CompileReturnVerifier ───

export interface CompileReturnVerifier {
  verify(request: CompileReturnRequest): Promise<boolean>;
}

// ─── CompileReturnTransport — replaceable outbound wire ───

export interface CompileReturnTransport {
  readonly endpointType: NonEmpty;
  readonly transportVersion: NonEmpty;
  send(
    endpoint: CompileReturnEndpointRecord,
    request: CompileReturnRequest
  ): Promise<CompileReturnAck>;
}

// ─── CompileReturnAck ───
// Re-exported here for transport contract completeness.
// Canonical definition is in workspace.ts (§3.2.1).

import type { CompileReturnAck } from './workspace.js';
export type { CompileReturnAck };
