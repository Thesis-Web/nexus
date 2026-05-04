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
export {};
