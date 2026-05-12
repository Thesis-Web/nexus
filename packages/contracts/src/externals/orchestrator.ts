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
import type { ExecutionPlan, PlanRejectionReason, SuggestedAgent } from './execution-plan.js';

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

// ─── RejectionCheckbackPayload ───
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7, log
// DIFF-PLANNER-LEXICON-CONTRACT-001.
//
// V1 additive contract addition. Carries the executable counter-suggestion
// data the workspace UI needs to drive an Accept-Suggestions / Cancel-Run
// modal when the planner rejects a preferred-agents preflight with usable
// alternatives.
//
// Two parallel data shapes on this payload:
//   - `recommendedSelectedAgentIds` — the EXECUTABLE replacement set.
//     Workspace re-issues the run with `selectedAgentIds` set to this
//     value verbatim on Accept-Suggestions. MUST cover every entry in
//     `missingCapabilities`.
//   - `alternativesByCapability` — the per-capability display detail
//     (one or more candidate agents per missing capability with prose
//     `reason`). UI shows this so the operator can see WHY the suggestion
//     was made; not consumed as input by the dispatch path.

export interface RejectionCheckbackPayload {
  reason: PlanRejectionReason;
  reasonDetail: NonEmpty;
  /** Capabilities the rejected selection did not cover. */
  missingCapabilities: NonEmpty[];
  /** Agents the operator originally picked (echo for UI). */
  rejectedSelectedAgentIds: Uuid[];
  /**
   * EXECUTABLE replacement set — workspace passes this directly to
   * `WorkspaceRunRequest.selectedAgentIds` on the re-issued run.
   * MUST cover every entry in `missingCapabilities`.
   */
  recommendedSelectedAgentIds: Uuid[];
  /** Display detail per missing capability — one or more candidate agents. */
  alternativesByCapability: Record<string, SuggestedAgent[]>;
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
  /**
   * AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7. Additive optional
   * field, V1. Null on success paths (`plan` non-null) and on rejection
   * paths that have no usable alternatives. Populated when the planner
   * rejects a preferred-agents preflight with executable
   * counter-suggestions — workspace UI consumes this to render the
   * Accept-Suggestions / Cancel-Run modal. Existing consumers ignore
   * the field. DIFF-PLANNER-LEXICON-CONTRACT-001.
   */
  rejection: RejectionCheckbackPayload | null;
}

// ─── Orchestrator — replaceable socket contract ───

export interface Orchestrator {
  readonly orchestratorSocketId: NonEmpty;
  readonly orchestratorVersion: NonEmpty;
  dispatch(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview>;
  cancel(runId: Uuid): Promise<void>; // V1 minimal cancel [OD-ORCH-05]
}
