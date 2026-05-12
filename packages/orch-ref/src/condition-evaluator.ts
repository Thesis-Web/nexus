// packages/orch-ref/src/condition-evaluator.ts
// Shared condition + node-type primitives — extracted from ref-deterministic-planner.ts
// per AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 1 + log
// MODULAR-CONDITION-EVALUATOR-001.
//
// Pure functions; no behavior change vs. the originating file. Used by:
//   - RefDeterministicPlanner (until Commit 6 deletion)
//   - DbLexiconTransformerPlanner (Commit 4 onward)
//   - RefDagExecutor (via run-coordinator)
//   - Unit tests (ORCH-13, ORCH-14)

import type { Uuid, NonEmpty, PlanCondition, PlanNode } from '@nexus/contracts';

// ─── Condition Evaluation — §3.1 type coercion law ───
// Exported for ORCH-14 testing and executor use.

export interface ConditionEvalResult {
  result: boolean;
  reason: 'match' | 'no_match' | 'type_mismatch';
}

export function evaluateCondition(
  condition: PlanCondition,
  sourceMetadata: Record<string, unknown>
): ConditionEvalResult {
  const sourceValue: unknown = sourceMetadata[condition.sourceField];

  switch (condition.operator) {
    case 'equals':
      return sourceValue === condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'not_equals':
      return sourceValue !== condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'exists':
      return sourceValue !== undefined && sourceValue !== null
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'not_exists':
      return sourceValue === undefined || sourceValue === null
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'gt': {
      if (
        typeof sourceValue !== 'number' ||
        !isFinite(sourceValue) ||
        typeof condition.value !== 'number' ||
        !isFinite(condition.value)
      ) {
        return { result: false, reason: 'type_mismatch' };
      }
      return sourceValue > condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };
    }

    case 'lt': {
      if (
        typeof sourceValue !== 'number' ||
        !isFinite(sourceValue) ||
        typeof condition.value !== 'number' ||
        !isFinite(condition.value)
      ) {
        return { result: false, reason: 'type_mismatch' };
      }
      return sourceValue < condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };
    }

    default:
      return { result: false, reason: 'type_mismatch' };
  }
}

// ─── Dispatch Branching — §5.4 ───
// Exported for ORCH-13 testing.

export type NodeTypeResult =
  | { valid: true; nodeType: PlanNode['nodeType']; requiresNvg: boolean; requiresNxs: boolean }
  | { valid: false; reason: NonEmpty };

export function determineNodeType(
  requiresNvg: boolean,
  requiresNxs: boolean,
  agentId: Uuid,
  orchestratorActorId: Uuid,
  isSecureHandoff: boolean
): NodeTypeResult {
  // Both true → malformed_request [§5.4]
  if (requiresNvg && requiresNxs) {
    return {
      valid: false,
      reason: 'Both requiresNvg and requiresNxs cannot be true on the same node' as NonEmpty,
    };
  }

  if (requiresNvg) {
    return { valid: true, nodeType: 'nvg_dispatch', requiresNvg: true, requiresNxs: false };
  }

  if (requiresNxs) {
    return { valid: true, nodeType: 'nxs_dispatch', requiresNvg: false, requiresNxs: true };
  }

  // Both false — distinguish local_control vs secure_agent_handoff
  if (isSecureHandoff) {
    return {
      valid: true,
      nodeType: 'secure_agent_handoff',
      requiresNvg: false,
      requiresNxs: false,
    };
  }

  // local_control: agentId MUST equal orchestratorActorId [§5.4]
  if (agentId !== orchestratorActorId) {
    return {
      valid: false,
      reason: 'local_control node agentId must equal orchestratorActorId' as NonEmpty,
    };
  }

  return { valid: true, nodeType: 'local_control', requiresNvg: false, requiresNxs: false };
}
