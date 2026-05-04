// packages/contracts/src/externals/execution-plan.ts
// AMEND-spec-nexus-orch §3 — Execution Plan Types
// Layer 2 — DAG structure produced by planner, consumed by executor.
//
// Replay determinism law [blueprint-K §11.6.5]:
// - planOrderIndex is immutable per node
// - Monotonic run sequence is sole ordering authority
// - Wall-clock timestamps are evidence metadata, not ordering input
// - planDigest excludes createdAt
export {};
