// packages/contracts/src/externals/factory-registries.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §5.1, §3.13 — Factory Registry Interfaces
// AMEND-spec-nexus-orch §4.4 — PlannerFactoryRegistry
// Layer 2 — factory registry contracts for externals manifest loading.
//
// Factory registries are populated in bootstrap Step 01 before any manifest
// loader runs. Every enabled manifest entry discriminator must resolve in its
// domain factory registry. Missing factory resolution fails closed.
//
// Pattern follows existing transport-registries.ts (§12.3.45–§12.3.47).
export {};
