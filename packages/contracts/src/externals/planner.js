// packages/contracts/src/externals/planner.ts
// AMEND-spec-nexus-orch §2 — Planner Socket Interface
// Layer 2 — pluggable planner contract.
//
// Planner authority bounds [blueprint-K §11.4.5]:
// - Planner MAY reject for orchestration feasibility reasons
// - Planner MUST NOT perform authorization, risk adjudication, policy deny,
//   OCT enforcement, or substitute for NXS/NVG decisions
// - Planner uses identity-provider ceiling as catalog visibility filter,
//   not authorization [blueprint-K §11.7.1]
export {};
