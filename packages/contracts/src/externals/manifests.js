// packages/contracts/src/externals/manifests.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.11 — Manifest Record Types
// AMEND-spec-nexus-orch §4.2 — OrchestratorManifestRecord Extensions
// Layer 2 — typed outputs of manifest loaders.
//
// These records describe sockets and endpoints. They do not compose runtime
// services. Plugin authors need socket shape compatibility; ExternalsRuntime
// remains bootstrap-owned and is NOT exported from this package.
//
// Law:
// - Manifest record types may live in contracts because plugin authors need
//   socket shape compatibility.
// - outputSlotPolicy is declared by the orchestrator manifest and enforced
//   by OutputCollector when it can resolve the run plan.
export {};
