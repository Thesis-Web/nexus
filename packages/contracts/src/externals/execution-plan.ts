// packages/contracts/src/externals/execution-plan.ts
// AMEND-spec-nexus-orch §3 — Execution Plan Types
// Layer 2 — DAG structure produced by planner, consumed by executor.
//
// Replay determinism law [blueprint-K §11.6.5]:
// - planOrderIndex is immutable per node
// - Monotonic run sequence is sole ordering authority
// - Wall-clock timestamps are evidence metadata, not ordering input
// - planDigest excludes createdAt

import type { Uuid, NonEmpty, Sha256Hex, IsoTimestamp } from '../types/index.js';
import type { EvidenceSentinel } from '../constants/index.js';

// ─── PlanNode ───

export interface PlanNode {
  nodeId: Uuid;
  planOrderIndex: number; // immutable, assigned at plan creation
  agentId: Uuid;
  taskSummary: NonEmpty; // metadata-only ref per visibility tier
  requiresNvg: boolean;
  requiresNxs: boolean;
  // Dispatch law [§5.4]:
  // - nvg_dispatch: requiresNvg=true, requiresNxs=false
  // - nxs_dispatch: requiresNvg=false, requiresNxs=true
  // - local_control: both false, agentId MUST equal orchestratorActorId,
  //   no external dispatch occurs
  // - secure_agent_handoff: both false, taskSummary MUST equal
  //   'OCT_SECURE_REDACTED', no prompt/metadata/capabilities in node,
  //   dispatch creates delegation+mailbox handoff only, secure agent
  //   performs its own NVG/NXS under delegated authority
  // - Both requiresNvg and requiresNxs true → malformed_request
  nodeType: 'nvg_dispatch' | 'nxs_dispatch' | 'local_control' | 'secure_agent_handoff';
  declaredRiskHint: EvidenceSentinel;
  // declaredRiskHint is non-authoritative metadata for UX/preflight
  // display only. It MUST NOT be used for NXS policy, delegation,
  // approval, grant, or denial decisions. Gate 02 remains the only
  // risk classification authority. V1 always EVIDENCE_SENTINEL.
  expectedOutputSlots: NonEmpty[];
  timeoutMs: number;
}

// ─── PlanEdgeType ───

export type PlanEdgeType = 'data_dependency' | 'conditional' | 'sequential';

// ─── PlanCondition ───
// Type coercion law [§3.1]:
// - gt/lt valid only when both source value and condition value are
//   finite numbers. No string numeric coercion.
// - Type mismatch evaluates false with reason: 'type_mismatch'.
// - equals/not_equals use strict equality (===).
// - exists/not_exists check value !== undefined && value !== null.

export type PlanConditionOperator = 'equals' | 'not_equals' | 'exists' | 'not_exists' | 'gt' | 'lt';

export interface PlanCondition {
  conditionId: Uuid;
  sourceField: NonEmpty;
  operator: PlanConditionOperator;
  value: string | number | boolean | null;
}

// §3.1 — Condition evaluation law
// gt/lt: if typeof sourceValue !== 'number' || !isFinite(sourceValue)
//        || typeof condition.value !== 'number' || !isFinite(condition.value)
//        → result = false, reason = 'type_mismatch'
// equals: sourceValue === condition.value (strict)
// not_equals: sourceValue !== condition.value (strict)
// exists: sourceValue !== undefined && sourceValue !== null
// not_exists: sourceValue === undefined || sourceValue === null

// ─── PlanEdge ───

export interface PlanEdge {
  edgeId: Uuid;
  sourceNodeId: Uuid;
  targetNodeId: Uuid;
  edgeType: PlanEdgeType;
  condition: PlanCondition | null; // non-null only for 'conditional' edges
  outputSlotRef: NonEmpty | null; // which output slot from source feeds target
}

// ─── ExecutionPlan ───
// planDigest law [§3.2]:
// planDigest = sha256(canonicalize({
//   planId, runId,
//   nodes sorted by planOrderIndex,
//   edges sorted by [sourceNodeId, targetNodeId, edgeType, edgeId],
//   plannerType, plannerVersion
// }))
// createdAt is EXCLUDED from digest — evidence metadata only.

export interface ExecutionPlan {
  planId: Uuid;
  runId: Uuid;
  planDigest: Sha256Hex;
  nodes: PlanNode[]; // sorted by planOrderIndex
  edges: PlanEdge[]; // sorted by [sourceNodeId, targetNodeId, edgeType, edgeId]
  plannerType: NonEmpty;
  plannerVersion: NonEmpty;
  createdAt: IsoTimestamp; // evidence metadata only, excluded from digest
}

// ─── PlanRejection ───
// All rejection reasons are orchestration feasibility, never governance.
// [blueprint-K §11.4.5, §11.7.3]

export type PlanRejectionReason =
  | 'no_capable_agent'
  | 'capability_outside_ceiling'
  | 'unmappable_request'
  | 'structural_constraint'
  | 'malformed_request'
  | 'max_split_exceeded';

export interface PlanRejection {
  rejected: true;
  reason: PlanRejectionReason;
  reasonDetail: NonEmpty;
  suggestedAlternatives: SuggestedAgent[];
}

export interface SuggestedAgent {
  agentId: Uuid;
  capability: NonEmpty;
  reason: NonEmpty;
}

// ─── NodeStatus (runtime) ───

export type NodeStatusType =
  | 'pending'
  | 'ready'
  | 'dispatched'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'timed_out';

export interface NodeStatus {
  nodeId: Uuid;
  planOrderIndex: number; // copied from PlanNode for sort stability
  status: NodeStatusType;
  runSequence: number; // monotonic counter at last state change
  completionMetadata: Record<string, unknown> | null;
  failureReason: NonEmpty | null;
  governanceDenied: boolean;
}

// ─── NodeDelegationBinding ───
// Each dispatchable node MUST have exactly one binding before dispatch.
// Missing binding → node_failed with reason 'delegation_missing'.

export interface NodeDelegationBinding {
  nodeId: Uuid;
  agentId: Uuid;
  delegationId: Uuid;
}

// ─── RunDagState (runtime) ───
// NodeStatus[] sorted by planOrderIndex for deterministic replay.
// No Map — JSON-safe, canonicalization-friendly.

export interface RunDagState {
  plan: ExecutionPlan;
  nodeStatuses: NodeStatus[]; // sorted by planOrderIndex, always
  nodeDelegations: NodeDelegationBinding[];
  runSequenceCounter: number; // monotonic, incremented on every event
  amendmentCount: number;
  cancelled: boolean; // cancel signal [OD-ORCH-05]
}
