/**
 * NVG OCT Ceiling Enforcer — spec §24.3
 * Hard wall: sensitive data → frontier denied.
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  MODEL_TIER,
  OCT_CEILINGS,
  DENIAL_CODE,
  type OctLevel,
  type ModelTier,
  type NvgClassificationResult,
  type NvgCeilingResult,
} from '@nexus/contracts';

export function isFrontierTier(tier: ModelTier): boolean {
  return (
    tier === MODEL_TIER.FRONTIER_GENERAL ||
    tier === MODEL_TIER.FRONTIER_REASONING ||
    tier === MODEL_TIER.FRONTIER_LIVE
  );
}

export function enforceOctModelCeiling(
  octLevel: OctLevel,
  requestedTier: ModelTier,
  classification: NvgClassificationResult
): NvgCeilingResult {
  const ceiling = OCT_CEILINGS[octLevel];
  if (!ceiling) {
    return {
      allowed: false,
      denialCode: DENIAL_CODE.NVG_OCT_CEILING_DENIED,
      reason: 'unknown OCT level',
    };
  }

  // Hard wall: sensitive data cannot reach frontier tiers
  if (classification.isSensitive && isFrontierTier(requestedTier)) {
    return {
      allowed: false,
      denialCode: DENIAL_CODE.NVG_CLASSIFICATION_DENIED,
      reason: 'sensitive data cannot reach frontier tiers',
    };
  }

  // OCT model tier ceiling
  if (!ceiling.modelTierCeiling.includes(requestedTier)) {
    return {
      allowed: false,
      denialCode: DENIAL_CODE.NVG_OCT_CEILING_DENIED,
      reason: `OCT ${octLevel} does not permit tier ${requestedTier}`,
    };
  }

  return { allowed: true };
}
