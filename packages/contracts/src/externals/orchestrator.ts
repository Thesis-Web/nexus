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

// ─── HOLE-LIFECYCLE-001 — Orchestrator → Workspace terminal handoff ───
//
// Component outline §3 (lifecycle ownership) + §HL #4: the orchestrator is a
// plug-and-play package and may NOT write the terminal `run_closed` event.
// The workspace owns the user-run lifecycle (run-open at ingress,
// run-closed after either the workspace-attached compile-return delivery
// path confirms the artifact OR the workspace itself decides to close
// based on a typed orchestration outcome). The orchestrator may emit only
// operational events inside its coordination scope (plan_created,
// orchestrator_dispatched, node_*, dag_*, compile_triggered,
// compile_not_applicable, final_response, planner_infeasible,
// user_cancelled_run) — these stay inside the orchestrator package because
// they describe its OWN coordination state, not run lifecycle authority.
//
// `RunOrchestrationTerminal` is the typed handoff the orchestrator returns
// to its caller (composition root → workspace) so the workspace can decide
// what canonical run_closed to write — or, in the `compile_dispatched`
// and `planner_infeasible` cases, whether to skip the close entirely
// because the delivery path or a later user callback owns it.

export type RunOrchestrationTerminalKind =
  /** Compile was triggered; compile-return delivery path will write run_closed. */
  | 'compile_dispatched'
  /** DAG completed but no compile-eligible inputs — workspace closes with
   *  closeReason='compile_not_applicable', finalOutcome='no_eligible_results'. */
  | 'no_compile_inputs'
  /** DAG executor threw — workspace closes with closeReason='error',
   *  finalOutcome='error'. */
  | 'executor_error'
  /** User rejected the plan checkback — workspace closes with
   *  closeReason='user_cancelled', finalOutcome='cancelled'. */
  | 'user_cancelled_plan'
  /** User cancelled mid-DAG — workspace closes with closeReason='user_cancelled',
   *  finalOutcome='cancelled'. */
  | 'user_cancelled_during_run'
  /** Planner returned infeasible. Per HL #4 the run STAYS OPEN until the
   *  user explicitly cancels (POST /workspace/runs/:runId/close); the
   *  workspace must NOT auto-close here. */
  | 'planner_infeasible';

export interface RunOrchestrationTerminal {
  readonly kind: RunOrchestrationTerminalKind;
  /** Optional human-readable detail. Never used as the canonical machine
   *  closeReason — the workspace maps `kind` to canonical closeReason and
   *  finalOutcome and puts this string in `closeReasonDetail` if useful. */
  readonly reason?: NonEmpty;
  /** Optional planId for traceability into the orch's operational events. */
  readonly planId?: Uuid;
}

export interface OrchestratorDispatchResult {
  readonly preview: OrchestratorPlanPreview;
  /**
   * Non-null when the orchestrator has finished its coordination scope and
   * the workspace must take the lifecycle decision. Null while the run is
   * still in progress — V1 implementations always set this on return from
   * `Orchestrator.dispatch` because `dispatch` blocks for the whole DAG +
   * compile handoff today. Future async-orchestrator implementations may
   * return `terminal: null` and signal terminal state out-of-band.
   */
  readonly terminal: RunOrchestrationTerminal | null;
}

// ─── Orchestrator — replaceable socket contract ───

export interface Orchestrator {
  readonly orchestratorSocketId: NonEmpty;
  readonly orchestratorVersion: NonEmpty;
  /**
   * HOLE-LIFECYCLE-001 fix: dispatch now returns the typed result
   * containing both the plan preview and the orchestration terminal kind
   * the workspace needs to write a canonical `run_closed`. Plug-in
   * orchestrators may NOT write `run_closed` themselves — that is workspace/
   * compile-return delivery-path authority only.
   */
  dispatch(request: WorkspaceRunRequest): Promise<OrchestratorDispatchResult>;
  cancel(runId: Uuid): Promise<void>; // V1 minimal cancel [OD-ORCH-05]
}
