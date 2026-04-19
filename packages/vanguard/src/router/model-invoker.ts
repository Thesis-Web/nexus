/**
 * NVG Model Invoker — spec §24.5
 * Health monitoring. Fallback constrained — never widens ceiling.
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  DENIAL_CODE,
  OCT_CEILINGS,
  type ModelTier,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type NvgOutboundRequest,
  type NvgClassificationResult,
  type NvgInvocationResult,
} from '@nexus/contracts';
import { isFrontierTier } from '../classifier/ceiling-enforcer.js';

/**
 * callEndpoint — governed transport contract.
 * In POC this is a stub. Production replaces with HTTP transport.
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

export async function invokeModel(
  tier: ModelTier,
  fallbackTier: ModelTier | null,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult,
  endpoints: ModelEndpoint[]
): Promise<NvgInvocationResult> {
  const primary = endpoints.find(e => e.tier === tier && e.healthy);
  if (primary) {
    const result = await callEndpoint(primary, request);
    return {
      ...result,
      fallbackApplied: false,
      fallbackFromTier: null,
      endpointUsed: primary,
    };
  }

  // Fallback — never widens data-class ceiling or OCT model tier ceiling (§26.2)
  if (fallbackTier) {
    if (classification.isSensitive && isFrontierTier(fallbackTier)) {
      return {
        success: false,
        fallbackApplied: false,
        fallbackFromTier: null,
        endpointUsed: null,
        denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
        reason: 'fallback tier would violate data classification ceiling',
      };
    }
    const octCeiling = OCT_CEILINGS[request.octLevel];
    if (octCeiling && !octCeiling.modelTierCeiling.includes(fallbackTier)) {
      return {
        success: false,
        fallbackApplied: false,
        fallbackFromTier: null,
        endpointUsed: null,
        denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
        reason: `fallback tier ${fallbackTier} outside OCT ${request.octLevel} model-tier ceiling`,
      };
    }
    const fallback = endpoints.find(e => e.tier === fallbackTier && e.healthy);
    if (fallback) {
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
