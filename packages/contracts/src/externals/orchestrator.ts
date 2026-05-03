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

import type { Uuid, Sha256Hex, NonEmpty } from '../types/index.js';
import type { RiskTier, EvidenceSentinel } from '../constants/index.js';
import type { WorkspaceRunRequest } from './workspace.js';
import type { ExecutionPlan } from './execution-plan.js';

// ─── OrchestratorSelectedAgent ───

export interface OrchestratorSelectedAgent {
  agentId: Uuid;
  taskId: Uuid;
  taskSummary: NonEmpty;
  requiresNvg: boolean;
  requiresNxs: boolean;
  estimatedRisk: RiskTier | EvidenceSentinel;
  expectedOutputSlots: NonEmpty[];
}

// ─── OrchestratorPlanPreview ───

export interface OrchestratorPlanPreview {
  runId: Uuid;
  orchestratorSocketId: NonEmpty;
  orchestratorActorId: Uuid;
  plannerMode: 'deterministic' | 'policy_template' | 'llm_assisted';
  selectedAgents: OrchestratorSelectedAgent[];
  requiresUserApproval: boolean;
  planDigest: Sha256Hex;
  plan: ExecutionPlan | null; // null = legacy flat preview, non-null = DAG
}

// ─── Orchestrator — replaceable socket contract ───

export interface Orchestrator {
  readonly orchestratorSocketId: NonEmpty;
  readonly orchestratorVersion: NonEmpty;
  dispatch(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview>;
  cancel(runId: Uuid): Promise<void>; // V1 minimal cancel [OD-ORCH-05]
}
