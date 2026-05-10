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

import type { Uuid, NonEmpty, IsoTimestamp } from '../types/index.js';
import type {
  ExecutionPlan,
  PlanRejection,
  SlotReadRef,
  NxsActionTemplate,
} from './execution-plan.js';

// ─── PromptVisibilityTier ───
// [blueprint-K §11.5, §11.5.4]
// OCT floor is non-negotiable. Policy can elevate, never lower.

export type PromptVisibilityTier = 'normal' | 'metadata' | 'oct_secure';

// ─── AgentRegistryReader ───
// Read-only view of agent registry for planner consultation.
// Planner never mutates the registry [blueprint-K §11.4.3].

export interface AgentCapabilityEntry {
  agentId: Uuid;
  actorClass: NonEmpty;
  capabilities: NonEmpty[];
  octTier: NonEmpty;
  environment: NonEmpty;
  enabled: boolean;
}

export interface AgentRegistryReader {
  findByCapability(capability: NonEmpty): Promise<AgentCapabilityEntry[]>;
  getById(agentId: Uuid): Promise<AgentCapabilityEntry | null>;
  listVisible(capabilityCeiling: NonEmpty[]): Promise<AgentCapabilityEntry[]>;
}

// ─── PlannerRequest — visibility-safe union ───
// Type-level enforcement: oct_secure physically cannot carry prompt content.
// [blueprint-K §11.5.1–§11.5.3]

export interface NormalPlannerRequest {
  tier: 'normal';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  prompt: NonEmpty;
  selectedAgentIds: Uuid[];
  requiredCapabilities: NonEmpty[];
  edgeHints: EdgeHint[];
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
  enteredAt: IsoTimestamp;
  /**
   * CLAUDE-CODE-MODEL-SELECTION-SPEC §2a. EndpointId surfaced from the
   * workspace model dropdown. Carried through PlannerRequest so the
   * downstream node-dispatch pipeline can hand it to NVG for biased
   * endpoint selection. Planner itself does NOT use this field for
   * scheduling — endpoint selection is NVG's responsibility, not the
   * planner's. `null` = Auto (policy).
   */
  preferredEndpointId: NonEmpty | null;
  /**
   * AMEND-spec-nexus-orch §5 extension — multi-node planning.
   * When non-null, the planner emits one node per sub-task instead of
   * one node per agent. `selectedAgentIds`, `requiredCapabilities`, and
   * `edgeHints` are ignored under the sub-task path; the planner reads
   * agent identity, per-node taskSummary/taskPrompt/expectedOutputSlots/
   * inputSlotReads/actionTemplate from `subTasks[]` and edges from
   * `subTaskEdges[]`. Null preserves the legacy single-prompt behavior.
   */
  subTasks?: SubTaskDecl[] | null;
  /** Edges between sub-tasks. Keyed by `subTaskKey`, not agentId, so
   *  same-agent multi-step plans are addressable. Ignored when
   *  subTasks is null. */
  subTaskEdges?: SubTaskEdgeHint[] | null;
}

export interface MetadataPlannerRequest {
  tier: 'metadata';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  // NO prompt field — planner sees structured metadata only
  requiredCapabilities: NonEmpty[];
  requiredSystemTargets: NonEmpty[];
  selectedAgentIds: Uuid[];
  edgeHints: EdgeHint[];
  templateRef: NonEmpty | null;
  taskShape: { subTaskCount: number; expectedOutputTypes: NonEmpty[] };
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
  enteredAt: IsoTimestamp;
  /**
   * CLAUDE-CODE-MODEL-SELECTION-SPEC §2a. EndpointId surfaced from the
   * workspace dropdown — visibility-safe (metadata only, no prompt content).
   * `null` = Auto (policy).
   */
  preferredEndpointId: NonEmpty | null;
  /** AMEND-spec-nexus-orch §5 extension — multi-node planning. See
   *  NormalPlannerRequest.subTasks for semantics. Sub-task taskPrompts
   *  may carry user content; metadata-tier requests still type-permit
   *  this because the workspace's metadata-tier path is itself the
   *  prompt-decomposing layer. */
  subTasks?: SubTaskDecl[] | null;
  subTaskEdges?: SubTaskEdgeHint[] | null;
}

export interface OctSecurePlannerRequest {
  tier: 'oct_secure';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  // NO prompt, NO metadata, NO capabilities, NO task shape
  // Planner sees auth identity only [blueprint-K §11.5.3]
  secureAgentId: Uuid;
  workspaceSocketId: NonEmpty;
  enteredAt: IsoTimestamp;
}

export type PlannerRequest =
  | NormalPlannerRequest
  | MetadataPlannerRequest
  | OctSecurePlannerRequest;

// ─── EdgeHint ───
// User-provided dependency hints. Optional [OD-ORCH-02].
// Absent → all-parallel. Present → validated as DAG.

export interface EdgeHint {
  sourceAgentId: Uuid;
  targetAgentId: Uuid;
  edgeType: 'data_dependency' | 'conditional' | 'sequential';
  conditionSpec: { sourceField: NonEmpty; operator: string; value: unknown } | null;
  outputSlotRef: NonEmpty | null;
}

// EdgeHint normalization law:
// - conditionSpec.operator MUST be one of PlanConditionOperator.
// - conditionSpec.value MUST be string | number | boolean | null.
// - Conditional edge requires non-null conditionSpec.
// - Non-conditional edge requires conditionSpec === null.
// - Invalid conditionSpec rejects plan as malformed_request.
// Planner validates all EdgeHints before constructing PlanEdges.

// ─── SubTaskDecl (multi-node planning) ───
// AMEND-spec-nexus-orch §5 extension.
//
// A discriminated union over the three dispatchable node kinds. Caller
// decides per sub-task whether the node thinks (nvg / secure_handoff)
// or fires a deterministic action (nxs). The planner stamps the
// `kind` onto PlanNode.nodeType and propagates the per-node fields so
// the executor + composition root dispatch each node according to its
// kind.

interface SubTaskDeclBase {
  /** Stable user-facing key. Edge refs + slot reads address sub-tasks
   *  by this key so two sub-tasks running on the same agent can be
   *  distinguished. MUST be unique within a single PlannerRequest. */
  subTaskKey: NonEmpty;
  agentId: Uuid;
  /** Short human-readable summary — surfaced in plan preview / checkback
   *  / run ledger node events. Per-node, NOT shared. */
  taskSummary: NonEmpty;
  /** Slots this node will WRITE on success. Drives OutputCollector
   *  slot validation + downstream `inputSlotReads` resolution. */
  expectedOutputSlots: NonEmpty[];
  /** Slots this node READS from upstream sub-tasks. Empty for roots. */
  inputSlotReads: SlotReadRef[];
}

/** LLM-driven sub-task. Composes into the round-trip loop with
 *  inputSlotReads seeded as user messages before turn 0. */
export interface NvgSubTask extends SubTaskDeclBase {
  kind: 'nvg';
  /** Per-node prompt. When null the dispatch falls back to the
   *  request-level prompt (useful for fan-out shapes where every
   *  branch sees the same instruction). */
  taskPrompt: NonEmpty | null;
}

/** Deterministic action — no LLM call. Composition root builds an
 *  AgentAction from `actionTemplate` + the agent's identity context
 *  and dispatches it through the 7-gate pipeline directly. */
export interface NxsSubTask extends SubTaskDeclBase {
  kind: 'nxs';
  actionTemplate: NxsActionTemplate;
}

/** Like `nvg` but with octLevel-aware redaction at slot-read
 *  boundaries. Phase 1: hard-deny on octLevel mismatch.
 *  Phase 2: real bidirectional redaction at the slot read. */
export interface SecureHandoffSubTask extends SubTaskDeclBase {
  kind: 'secure_handoff';
  taskPrompt: NonEmpty | null;
}

export type SubTaskDecl = NvgSubTask | NxsSubTask | SecureHandoffSubTask;

// ─── SubTaskEdgeHint ───
// Sibling of `EdgeHint` for multi-node plans. Address by subTaskKey
// instead of agentId so same-agent multi-step DAGs are well-formed.

export interface SubTaskEdgeHint {
  sourceSubTaskKey: NonEmpty;
  targetSubTaskKey: NonEmpty;
  edgeType: 'data_dependency' | 'conditional' | 'sequential';
  conditionSpec: { sourceField: NonEmpty; operator: string; value: unknown } | null;
  outputSlotRef: NonEmpty | null;
}

// ─── PlannerContext ───

export interface PlannerContext {
  registry: AgentRegistryReader;
  capabilityCeiling: NonEmpty[];
  maxSplitDepth: number;
}

// ─── Planner ───

export interface Planner {
  readonly plannerType: NonEmpty;
  readonly plannerVersion: NonEmpty;
  plan(request: PlannerRequest, context: PlannerContext): Promise<ExecutionPlan | PlanRejection>;
}
