/**
 * NVG Model Tier Registry — spec §26, blueprint §14
 *
 * Governed tier definitions, tier lookup, endpoint availability, and
 * fallback constraint enforcement.
 *
 * Responsibilities:
 *   - Define the 6 governed tiers (MODULAR-011: open governed string type)
 *   - Register and look up model endpoints by tier
 *   - Check tier availability (healthy endpoints exist)
 *   - Enforce fallback-never-widens constraint (§26.2)
 *
 * Does NOT own:
 *   - Policy evaluation → policy-engine.ts
 *   - Route selection → model-router.ts
 *   - Model invocation → model-router.ts
 *
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  MODEL_TIER,
  type ModelTier,
  type ModelEndpoint,
  type NonEmpty,
  type IsoTimestamp,
  type DataClass,
  type OctLevel,
  OCT_CEILINGS,
} from '@nexus/contracts';
import { isFrontierTier } from '../classifier/ceiling-enforcer.js';
import { isSensitiveDataClass } from '@nexus/contracts';

// ── Governed tier order (sensitivity ceiling: higher index = more permissive) ──

const TIER_SENSITIVITY_ORDER: ModelTier[] = [
  MODEL_TIER.ON_PREM_SENSITIVE,
  MODEL_TIER.ON_PREM_GENERAL,
  MODEL_TIER.FALLBACK,
  MODEL_TIER.FRONTIER_GENERAL,
  MODEL_TIER.FRONTIER_REASONING,
  MODEL_TIER.FRONTIER_LIVE,
];

// ── Fallback constraint result ──────────────────────────────────────────────

export interface FallbackConstraintResult {
  allowed: boolean;
  reason?: string;
}

// ── Tier Registry ───────────────────────────────────────────────────────────

export class TierRegistry {
  private readonly endpoints = new Map<string, ModelEndpoint[]>();

  /**
   * Register a model endpoint under its tier.
   * Adding a new tier is a registry update — not a code change (MODULAR-011).
   */
  registerEndpoint(endpoint: ModelEndpoint): void {
    const tier = endpoint.tier;
    const existing = this.endpoints.get(tier) ?? [];
    // Replace if same endpointId, otherwise append
    const filtered = existing.filter(e => e.endpointId !== endpoint.endpointId);
    filtered.push(endpoint);
    this.endpoints.set(tier, filtered);
  }

  /** Look up all endpoints registered for a tier. */
  getEndpoints(tier: ModelTier): ModelEndpoint[] {
    return this.endpoints.get(tier) ?? [];
  }

  /** Look up healthy endpoints for a tier. */
  getHealthyEndpoints(tier: ModelTier): ModelEndpoint[] {
    return this.getEndpoints(tier).filter(e => e.healthy);
  }

  /** Check whether a tier has at least one healthy endpoint. */
  isTierAvailable(tier: ModelTier): boolean {
    return this.getHealthyEndpoints(tier).length > 0;
  }

  /** Return all registered tier names. */
  getRegisteredTiers(): ModelTier[] {
    return [...this.endpoints.keys()];
  }

  /**
   * §26.2 — Fallback constraint enforcement.
   * Fallback never widens data-class ceiling or OCT model tier ceiling.
   * Returns whether the proposed fallback tier is permitted.
   */
  checkFallbackConstraint(
    primaryTier: ModelTier,
    fallbackTier: ModelTier,
    effectiveDataClass: DataClass,
    octLevel: OctLevel
  ): FallbackConstraintResult {
    // Non-widening check — fallback must be same or more restrictive than primary (NVG-FALLBACK-001)
    const primaryIdx = this.getTierSensitivityIndex(primaryTier);
    const fallbackIdx = this.getTierSensitivityIndex(fallbackTier);
    if (fallbackIdx > primaryIdx) {
      return {
        allowed: false,
        reason: `fallback to ${fallbackTier} denied: widens primary tier ${primaryTier}`,
      };
    }

    // Sensitive data → frontier fallback = denied
    if (isSensitiveDataClass(effectiveDataClass) && isFrontierTier(fallbackTier)) {
      return {
        allowed: false,
        reason: `fallback to ${fallbackTier} denied: sensitive data cannot reach frontier tiers`,
      };
    }

    // OCT model tier ceiling check
    const octCeiling = OCT_CEILINGS[octLevel];
    if (octCeiling && !octCeiling.modelTierCeiling.includes(fallbackTier)) {
      return {
        allowed: false,
        reason: `fallback to ${fallbackTier} denied: outside OCT ${octLevel} model-tier ceiling`,
      };
    }

    return { allowed: true };
  }

  /**
   * Resolve tier sensitivity index for ordering comparisons.
   * Unknown tiers get the lowest index (most restrictive) — safe default.
   */
  getTierSensitivityIndex(tier: ModelTier): number {
    const idx = TIER_SENSITIVITY_ORDER.indexOf(tier);
    return idx >= 0 ? idx : 0;
  }

  /** Update health status for an endpoint. */
  updateEndpointHealth(endpointId: NonEmpty, healthy: boolean, checkedAt: IsoTimestamp): boolean {
    for (const [, endpoints] of this.endpoints) {
      const ep = endpoints.find(e => e.endpointId === endpointId);
      if (ep) {
        ep.healthy = healthy;
        ep.lastCheckAt = checkedAt;
        return true;
      }
    }
    return false;
  }
}
