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
 *   - Health-recovery cooldown: unhealthy endpoints become probationary after
 *     a configurable cooldown so transient outages don't permanently sideline
 *     endpoints. The next request to that tier picks the probationary endpoint
 *     up; success → healthy, failure → cooldown restarts (CHECKBACK-spec §5).
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

/** Default cooldown before an unhealthy endpoint enters probation (60s). */
const DEFAULT_HEALTH_COOLDOWN_MS = 60_000;

export interface TierRegistryOptions {
  /**
   * Cooldown in ms before an unhealthy endpoint becomes probationary
   * (eligible for one retry on the next tier request). Default 60_000.
   */
  healthCooldownMs?: number;
  /**
   * Clock injection for deterministic tests. Defaults to Date.now.
   */
  now?: () => number;
}

export class TierRegistry {
  private readonly endpoints = new Map<string, ModelEndpoint[]>();
  /**
   * endpointId → epoch ms when it was last marked unhealthy. An endpoint with
   * an entry here has `healthy === false`. After `healthCooldownMs` elapses
   * the endpoint becomes probationary: `getHealthyEndpoints` includes it so
   * the model-router gets one shot to recover it. Success removes the entry;
   * a fresh failure resets the timestamp (cooldown restarts).
   */
  private readonly unhealthySince = new Map<string, number>();
  private readonly healthCooldownMs: number;
  private readonly now: () => number;

  constructor(options: TierRegistryOptions = {}) {
    this.healthCooldownMs = options.healthCooldownMs ?? DEFAULT_HEALTH_COOLDOWN_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Register a model endpoint under its tier.
   * Adding a new tier is a registry update — not a code change (MODULAR-011).
   * Re-registering an endpoint clears any prior cooldown state — registration
   * is treated as a fresh declaration of intent.
   */
  registerEndpoint(endpoint: ModelEndpoint): void {
    const tier = endpoint.tier;
    const existing = this.endpoints.get(tier) ?? [];
    // Replace if same endpointId, otherwise append
    const filtered = existing.filter(e => e.endpointId !== endpoint.endpointId);
    filtered.push(endpoint);
    this.endpoints.set(tier, filtered);
    this.unhealthySince.delete(endpoint.endpointId);
  }

  /** Look up all endpoints registered for a tier. */
  getEndpoints(tier: ModelTier): ModelEndpoint[] {
    return this.endpoints.get(tier) ?? [];
  }

  /**
   * Look up endpoints eligible for invocation: either currently healthy, or
   * unhealthy but past the cooldown (probationary). Probationary endpoints
   * give the model-router one shot to recover them — success flips healthy
   * back on, failure restarts the cooldown.
   */
  getHealthyEndpoints(tier: ModelTier): ModelEndpoint[] {
    const now = this.now();
    return this.getEndpoints(tier).filter(e => this.isEligible(e, now));
  }

  /**
   * Probationary check — true iff the endpoint is currently unhealthy but
   * past its cooldown window. Surfaces probation state for callers that want
   * to log "trying to recover" telemetry.
   */
  isProbationary(endpoint: ModelEndpoint): boolean {
    if (endpoint.healthy) return false;
    const since = this.unhealthySince.get(endpoint.endpointId);
    if (since === undefined) return false;
    return this.now() - since >= this.healthCooldownMs;
  }

  /** Check whether a tier has at least one healthy or probationary endpoint. */
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

  /**
   * Update health status for an endpoint. Maintains the cooldown bookkeeping
   * required by `getHealthyEndpoints`:
   *   - healthy=true  → flip ep.healthy on, clear cooldown entry
   *   - healthy=false → flip ep.healthy off, set cooldown timestamp to now
   *
   * Re-marking already-unhealthy as unhealthy resets the cooldown (the most
   * recent failure is the authoritative timestamp — probation restarts).
   */
  updateEndpointHealth(endpointId: NonEmpty, healthy: boolean, checkedAt: IsoTimestamp): boolean {
    for (const [, endpoints] of this.endpoints) {
      const ep = endpoints.find(e => e.endpointId === endpointId);
      if (ep) {
        ep.healthy = healthy;
        ep.lastCheckAt = checkedAt;
        if (healthy) {
          this.unhealthySince.delete(endpointId);
        } else {
          this.unhealthySince.set(endpointId, this.now());
        }
        return true;
      }
    }
    return false;
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private isEligible(ep: ModelEndpoint, now: number): boolean {
    if (ep.healthy) return true;
    const since = this.unhealthySince.get(ep.endpointId);
    if (since === undefined) return false;
    return now - since >= this.healthCooldownMs;
  }
}
