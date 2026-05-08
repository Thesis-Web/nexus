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
import type { ExecutionPlan, PlanRejection } from './execution-plan.js';

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
