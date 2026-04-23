/**
 * NVG Model Router — spec §24.5
 * Route selection and model invocation using policy result + registry + health.
 * Fallback constrained via TierRegistry (§26.2) — never widens ceiling.
 * Layer 3 — imports from @nexus/contracts only (+ internal vanguard modules).
 *
 * Responsibilities:
 *   - Select healthy endpoint from TierRegistry for the routed tier
 *   - Invoke model endpoint (POC stub — production replaces with HTTP transport)
 *   - Apply fallback via TierRegistry constraint check
 *
 * Does NOT own:
 *   - Policy evaluation → policy-engine.ts
 *   - Tier definitions / availability → tier-registry.ts
 */
import {
  DENIAL_CODE,
  type ModelTier,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type NvgOutboundRequest,
  type NvgClassificationResult,
  type NvgInvocationResult,
} from '@nexus/contracts';
import type { TierRegistry } from './tier-registry.js';

/**
 * callEndpoint — governed transport contract.
 * In POC this is a stub. Production replaces with actual HTTP transport.
 * Five invariants from §24.5 apply.
 */
export async function callEndpoint(
  endpoint: ModelEndpoint,
  _request: NvgOutboundRequest
): Promise<ModelEndpointResponse> {
  // POC stub — production replaces with actual HTTP transport
  const startMs = Date.now();
  return {
    success: true,
    responseSize: 0,
    latencyMs: Date.now() - startMs,
  };
}

/**
 * invokeModel — select endpoint from registry, invoke, handle fallback.
 * Fallback constraint enforcement delegated to TierRegistry (§26.2).
 */
export async function invokeModel(
  tier: ModelTier,
  fallbackTier: ModelTier | null,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult,
  registry: TierRegistry
): Promise<NvgInvocationResult> {
  // Primary tier — look up healthy endpoint from registry
  const primaryEndpoints = registry.getHealthyEndpoints(tier);
  if (primaryEndpoints.length > 0) {
    const primary = primaryEndpoints[0]!;
    const result = await callEndpoint(primary, request);
    return {
      ...result,
      fallbackApplied: false,
      fallbackFromTier: null,
      endpointUsed: primary,
    };
  }

  // Fallback — constraint check via registry (§26.2: never widens ceiling)
  if (fallbackTier) {
    const constraint = registry.checkFallbackConstraint(
      fallbackTier,
      classification.effectiveDataClass,
      request.octLevel
    );
    if (!constraint.allowed) {
      return {
        success: false,
        fallbackApplied: false,
        fallbackFromTier: null,
        endpointUsed: null,
        denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
        reason: constraint.reason ?? 'fallback constraint denied',
      };
    }

    const fallbackEndpoints = registry.getHealthyEndpoints(fallbackTier);
    if (fallbackEndpoints.length > 0) {
      const fallback = fallbackEndpoints[0]!;
      const result = await callEndpoint(fallback, request);
      return {
        ...result,
        fallbackApplied: true,
        fallbackFromTier: tier,
        endpointUsed: fallback,
      };
    }
  }

  return {
    success: false,
    fallbackApplied: false,
    fallbackFromTier: null,
    endpointUsed: null,
    denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
    reason: `no healthy endpoint for tier ${tier}`,
  };
}
