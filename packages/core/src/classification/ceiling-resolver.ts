/**
 * Ceiling Resolver — spec §10.4, blueprint §7.3
 *
 * resolveEffectiveCeiling: intersection of identity-provider ceiling and OCT ceiling.
 * "More restrictive always wins." Not configurable.
 *
 * Layer 1 — imports from Layer 2 (contracts) only.
 */
import {
  RISK_TIER_ORDER,
  EVIDENCE_SENTINEL,
  type RiskTier,
  type CapabilityCeiling,
  type OctCeiling,
  type EffectiveCeiling,
  type ModelTier,
} from '../types/index.js';

/**
 * Return the less-permissive of two risk tiers.
 * Lower index in RISK_TIER_ORDER = less permissive.
 */
export function riskTierMin(a: RiskTier, b: RiskTier): RiskTier {
  const idxA = RISK_TIER_ORDER.indexOf(a);
  const idxB = RISK_TIER_ORDER.indexOf(b);
  return idxA <= idxB ? a : b;
}

/**
 * Set intersection — items that appear in both arrays.
 * Wildcard ['*'] means "no restriction from this source."
 */
export function intersect(a: string[], b: string[]): string[] {
  if (a.includes('*')) return b;
  if (b.includes('*')) return a;
  return a.filter(item => b.includes(item));
}

/**
 * §10.4: Resolve effective ceiling from identity-provider ceiling + OCT ceiling.
 * OCT-COMPILE: actionRiskCeiling is EVIDENCE_SENTINEL — caller should deny before
 * calling this function, but defensive handling is included.
 */
export function resolveEffectiveCeiling(
  identityProviderCeiling: CapabilityCeiling,
  octCeiling: OctCeiling
): EffectiveCeiling {
  const octRisk = octCeiling.actionRiskCeiling;

  // OCT-COMPILE sentinel: identity ceiling governs (moot — Gate 02 denies first)
  const effectiveRisk =
    octRisk === EVIDENCE_SENTINEL
      ? identityProviderCeiling.maxRiskTier
      : riskTierMin(identityProviderCeiling.maxRiskTier, octRisk as RiskTier);

  // OCT system/capability wildcards: ['*'] means no OCT restriction
  const octSystems = octCeiling.allowedSystems.includes('*')
    ? identityProviderCeiling.allowedSystems
    : octCeiling.allowedSystems;
  const octCaps = octCeiling.allowedCapabilities.includes('*')
    ? identityProviderCeiling.allowedCapabilities
    : octCeiling.allowedCapabilities;

  return {
    maxRiskTier: effectiveRisk,
    allowedSystems: intersect(identityProviderCeiling.allowedSystems, octSystems),
    allowedCapabilities: intersect(identityProviderCeiling.allowedCapabilities, octCaps),
    modelTierCeiling: octCeiling.modelTierCeiling as ModelTier[],
  };
}
