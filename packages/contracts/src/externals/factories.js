// packages/contracts/src/externals/factories.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.13 — Factory Contracts
// AMEND-spec-nexus-orch §4.3 — PlannerFactory
// Layer 2 — factory contracts are the breaker slots.
//
// Manifests select a type discriminator; bootstrap factory registries resolve
// that discriminator to a known factory. YAML never executes arbitrary code.
//
// Factory law:
// - Factory registries are populated in bootstrap Step 01 before manifest loading.
// - Every enabled manifest entry discriminator must resolve in its domain
//   factory registry.
// - Missing factory resolution fails closed before API traffic starts.
// - Factories may instantiate adapters/transports/backends only for approved
//   local implementation identifiers already registered in code.
// - Manifest YAML must not carry executable import paths or arbitrary package code.
export {};
