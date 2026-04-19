/**
 * NVG Routing Policy Engine — spec §24.4, §25
 * First matching rule governs. No match → deny (default-deny posture).
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  isSensitiveDataClass,
  type DataClass,
  type NvgOutboundRequest,
  type NvgClassificationResult,
  type NvgRoutingPolicy,
  type NvgRoutingRule,
  type NvgRoutingDecision,
} from '@nexus/contracts';
import { isFrontierTier } from '../classifier/ceiling-enforcer.js';

export function matchesRoutingCondition(
  cond: NvgRoutingRule['conditions'],
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): boolean {
  if (cond.dataClasses && !cond.dataClasses.includes(classification.effectiveDataClass))
    return false;
  if (cond.octLevels && !cond.octLevels.includes(request.octLevel)) return false;
  if (cond.taskTypes && !cond.taskTypes.includes(request.taskIntent)) return false;
  if (cond.costCeiling !== undefined && request.costPreference === 'high') return false;
  return true;
}

export function evaluateRoutingPolicy(
  policy: NvgRoutingPolicy,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): NvgRoutingDecision {
  for (const rule of [...policy.rules].sort((a, b) => a.priority - b.priority)) {
    if (matchesRoutingCondition(rule.conditions, request, classification)) {
      return {
        matched: true,
        ruleId: rule.ruleId,
        routeTo: rule.routeTo,
        fallbackTier: rule.fallbackTier ?? null,
      };
    }
  }
  // Default deny — no matching rule
  return { matched: false, ruleId: null, routeTo: null, fallbackTier: null };
}

/** §25.2 — validate policy at load time. Rejects sensitive→frontier routes. */
export function validateRoutingPolicy(policy: NvgRoutingPolicy): void {
  for (const rule of policy.rules) {
    const hasSensitive = rule.conditions.dataClasses?.some(isSensitiveDataClass);
    if (hasSensitive && isFrontierTier(rule.routeTo)) {
      throw new Error(
        `ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} routes sensitive data to frontier tier ${rule.routeTo}`
      );
    }
    if (hasSensitive && rule.fallbackTier && isFrontierTier(rule.fallbackTier)) {
      throw new Error(
        `ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} fallback routes sensitive data to frontier tier ${rule.fallbackTier}`
      );
    }
  }
}
