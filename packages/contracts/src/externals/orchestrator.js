// packages/contracts/src/externals/orchestrator.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.3, §3.3.1 — Orchestrator Contracts
// AMEND-spec-nexus-orch §4.1 — Orchestrator Contract Extensions
// Layer 2 — orchestrator plan preview, selected agent, orchestrator socket.
//
// OrchestratorPlanPreview law:
// - plannerMode = 'llm_assisted' is legal only if the orchestrator actor is
//   registered and the model call goes through NVG.
// - Default V1 reference planner uses 'deterministic'.
// - expectedOutputSlots SHALL be present for every selected agent entry.
//   Nexus infra validates, records, carries, and checks it but does not
//   generate orchestration intelligence.
// - planDigest = sha256(canonicalize({ runId, orchestratorSocketId,
//   orchestratorActorId, plannerMode, selectedAgents, requiresUserApproval }))
// - A plan preview is metadata. It is not authority to execute actions.
//
// Orchestrator socket law:
// - The orchestrator plugin declares task IDs, selected agents, required
//   checkpoints, and expected output slots.
// - Nexus infra validates, records, and routes those declarations.
// - If an orchestrator uses LLM-assisted planning, that model-bound work
//   must route through NVG under the orchestrator actor.
export {};
