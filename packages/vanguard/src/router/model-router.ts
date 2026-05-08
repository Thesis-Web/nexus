/**
 * NVG Model Router — spec §24.5
 * Route selection and model invocation using policy result + registry + health.
 * Fallback constrained via TierRegistry (§26.2) — never widens ceiling.
 * Layer 3 — imports from @nexus/contracts only (+ internal vanguard modules).
 *
 * NISP-001.A updates:
 *   - callEndpoint dispatches via ModelTransportAdapterRegistry (§24.5.2)
 *   - invokeModel: same-tier retry — all healthy primary endpoints in manifest
 *     order before fallbackTier eligibility (§24.5.3)
 *   - priorAttempts: captures every failed attempt for trail visibility
 *   - FALLBACK_TRIGGERING_CODES: only retriable denial codes trigger fallback
 *
 * WIRE-003 fix:
 *   - invokeModel calls registry.updateEndpointHealth() after every callEndpoint
 *     result — success marks healthy, failure marks unhealthy. Feeds back into
 *     getHealthyEndpoints() for subsequent invocation selection (§24.5, blueprint §13.6).
 *
 * NvgTransportContext is optional for backward compatibility with pipeline
 * integration tests (§38.5) that test classify→route→invoke→log flow, not
 * transport dispatch. When absent, callEndpoint returns a stub success
 * response. Production bootstrap always provides the transport context.
 */
import {
  DENIAL_CODE,
  type ModelTier,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type NvgOutboundRequest,
  type NvgClassificationResult,
  type NvgInvocationResult,
  type NvgTransportContext,
  type InvocationAttempt,
  type IsoTimestamp,
} from '@nexus/contracts';
import type { TierRegistry } from './tier-registry.js';

/**
 * Denial codes that trigger same-tier retry and cross-tier fallback (§24.5.3).
 * Auth, config, and parse errors are NOT retriable — they would repeat.
 * Typed as Set<string> because DenialCode is string (open governed type).
 */
const FALLBACK_TRIGGERING_CODES: Set<string> = new Set([
  DENIAL_CODE.NVG_ENDPOINT_TIMEOUT,
  DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
  DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED,
  DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR,
]);

/**
 * callEndpoint — governed transport dispatcher (§24.5.2).
 *
 * When transportContext is provided: looks up the registered adapter by
 * endpoint.adapterId, delegates to adapter.invoke(). Returns UNKNOWN_ADAPTER
 * denial if the adapterId is not registered.
 *
 * T6-F03 FIX: transportContext is MANDATORY. The stub-success path for missing
 * transport is removed. Tests must inject a fixture transport adapter explicitly.
 * Production bootstrap always provides the context.
 */
export async function callEndpoint(
  endpoint: ModelEndpoint,
  request: NvgOutboundRequest,
  transportContext: NvgTransportContext
): Promise<ModelEndpointResponse> {
  const startMs = Date.now();

  // Production path: adapter registry dispatch
  const adapter = transportContext.registry.get(endpoint.adapterId);
  if (adapter === null) {
    return {
      success: false,
      denialCode: DENIAL_CODE.NVG_TRANSPORT_UNKNOWN_ADAPTER,
      reason: `adapterId '${endpoint.adapterId}' not registered`,
      latencyMs: Date.now() - startMs,
    };
  }

  return adapter.invoke(endpoint, request, transportContext.secretSource);
}

/**
 * Build an NvgInvocationResult from a ModelEndpointResponse, handling
 * exactOptionalPropertyTypes correctly: optional fields are only set
 * when the source value is defined.
 */
function buildInvocationResult(
  result: ModelEndpointResponse,
  endpoint: ModelEndpoint | null,
  fallbackApplied: boolean,
  fallbackFromTier: ModelTier | null,
  priorAttempts: InvocationAttempt[]
): NvgInvocationResult {
  const inv: NvgInvocationResult = {
    success: result.success,
    fallbackApplied,
    fallbackFromTier,
    endpointUsed: endpoint,
  };
  if (result.denialCode !== undefined) inv.denialCode = result.denialCode;
  if (result.reason !== undefined) inv.reason = result.reason;
  if (result.responseSize !== undefined) inv.responseSize = result.responseSize;
  if (result.latencyMs !== undefined) inv.latencyMs = result.latencyMs;
  if (result.opaqueProviderResponse !== undefined) {
    inv.opaqueProviderResponse = result.opaqueProviderResponse;
  }
  if (result.providerModelNameReturned !== undefined) {
    inv.providerModelNameReturned = result.providerModelNameReturned;
  }
  if (priorAttempts.length > 0) inv.priorAttempts = priorAttempts;
  return inv;
}

/**
 * invokeModel — same-tier retry + constrained fallback (§24.5.3).
 *
 * 1. Iterate ALL healthy primary endpoints in manifest (registry) order
 * 2. For each: callEndpoint; on success → return; on retriable failure → next
 * 3. After all primary endpoints exhausted: consider fallbackTier
 * 4. Fallback constraint check via TierRegistry (never widens ceiling)
 * 5. Single-shot fallback: try first healthy fallback endpoint
 * 6. priorAttempts captures every failed attempt for trail visibility
 *
 * WIRE-003: After every callEndpoint result, registry.updateEndpointHealth()
 * is called. Success → marks healthy. Failure → marks unhealthy. This feeds
 * back into getHealthyEndpoints() for subsequent invocation selection.
 *
 * CLAUDE-CODE-MODEL-SELECTION-SPEC §3 — when the request carries a
 * `preferredEndpointId`, the caller (nvg-service) has already resolved it to
 * `preferredEndpoint` and verified its tier sits within the OCT model-tier
 * ceiling. Here we honor it as the first attempt:
 *   - healthy/probationary + within ceiling → invoke; success returns directly
 *   - failed-retriable invocation → record the attempt and continue with the
 *     policy-selected primary tier (silent fallback is permitted on health
 *     issues per spec §3 case 1d)
 *   - non-retriable failure → return immediately (matches existing behavior)
 * `preferredEndpoint == null` is the Auto (policy) path — original behavior.
 */
export async function invokeModel(
  tier: ModelTier,
  fallbackTier: ModelTier | null,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult,
  registry: TierRegistry,
  transportContext: NvgTransportContext,
  preferredEndpoint: ModelEndpoint | null = null
): Promise<NvgInvocationResult> {
  const priorAttempts: InvocationAttempt[] = [];

  // ── Preference-first attempt (§3 case 1c) ──
  // Caller has already verified ceiling allows the preferred tier; we only
  // need to gate on liveness (healthy or probationary).
  if (preferredEndpoint !== null && registry.isEndpointEligible(preferredEndpoint)) {
    const result = await callEndpoint(preferredEndpoint, request, transportContext);
    registry.updateEndpointHealth(
      preferredEndpoint.endpointId,
      result.success,
      new Date().toISOString() as IsoTimestamp
    );

    if (result.success) {
      return buildInvocationResult(result, preferredEndpoint, false, null, priorAttempts);
    }

    // Non-retriable failure on the preferred endpoint terminates here —
    // bumping into the policy-selected tier would mask config/auth errors.
    const denialCode = result.denialCode ?? DENIAL_CODE.NVG_FALLBACK_DENIED;
    if (!FALLBACK_TRIGGERING_CODES.has(denialCode)) {
      return buildInvocationResult(result, preferredEndpoint, false, null, priorAttempts);
    }

    // Retriable failure → record the attempt and silently fall through to
    // the policy-selected tier path (spec §3 case 1d).
    priorAttempts.push({
      endpointUsed: preferredEndpoint.endpointId,
      tier: preferredEndpoint.tier,
      adapterId: preferredEndpoint.adapterId,
      modelName: preferredEndpoint.modelName,
      denialCode,
      reason: result.reason ?? 'preferred_endpoint_failed',
      latencyMs: result.latencyMs ?? 0,
      attemptedAt: new Date().toISOString() as IsoTimestamp,
    });
  }

  // ── Same-tier retry: try ALL healthy primary endpoints in manifest order ──
  const primaryEndpoints = registry.getHealthyEndpoints(tier).filter(
    // Already attempted above — skip to avoid double-call when policy tier
    // happens to contain the preference.
    e => preferredEndpoint === null || e.endpointId !== preferredEndpoint.endpointId
  );
  for (const primary of primaryEndpoints) {
    const result = await callEndpoint(primary, request, transportContext);

    // WIRE-003: update health state after every transport call
    registry.updateEndpointHealth(
      primary.endpointId,
      result.success,
      new Date().toISOString() as IsoTimestamp
    );

    if (result.success) {
      return buildInvocationResult(result, primary, false, null, priorAttempts);
    }

    // Non-retriable failure → return immediately, no retry
    const denialCode = result.denialCode ?? DENIAL_CODE.NVG_FALLBACK_DENIED;
    if (!FALLBACK_TRIGGERING_CODES.has(denialCode)) {
      return buildInvocationResult(result, primary, false, null, priorAttempts);
    }

    // Retriable failure → record attempt and try next same-tier endpoint
    // NVG-RPT-002: carry endpoint metadata for self-contained trail forensics
    priorAttempts.push({
      endpointUsed: primary.endpointId,
      tier: primary.tier,
      adapterId: primary.adapterId,
      modelName: primary.modelName,
      denialCode,
      reason: result.reason ?? 'unknown',
      latencyMs: result.latencyMs ?? 0,
      attemptedAt: new Date().toISOString() as IsoTimestamp,
    });
  }

  // ── Fallback: all primary endpoints exhausted ──
  if (fallbackTier) {
    const constraint = registry.checkFallbackConstraint(
      tier,
      fallbackTier,
      classification.effectiveDataClass,
      request.octLevel
    );
    if (!constraint.allowed) {
      const inv: NvgInvocationResult = {
        success: false,
        fallbackApplied: false,
        fallbackFromTier: null,
        endpointUsed: null,
        denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
        reason: constraint.reason ?? 'fallback constraint denied',
      };
      if (priorAttempts.length > 0) inv.priorAttempts = priorAttempts;
      return inv;
    }

    // Single-shot fallback: first healthy endpoint on fallback tier
    const fallbackEndpoints = registry.getHealthyEndpoints(fallbackTier);
    if (fallbackEndpoints.length > 0) {
      const fallback = fallbackEndpoints[0]!;
      const result = await callEndpoint(fallback, request, transportContext);

      // WIRE-003: update health state after every transport call
      registry.updateEndpointHealth(
        fallback.endpointId,
        result.success,
        new Date().toISOString() as IsoTimestamp
      );

      if (result.success) {
        return buildInvocationResult(result, fallback, true, tier, priorAttempts);
      }

      // Fallback failed — record attempt
      // NVG-RPT-002: carry endpoint metadata for self-contained trail forensics
      priorAttempts.push({
        endpointUsed: fallback.endpointId,
        tier: fallback.tier,
        adapterId: fallback.adapterId,
        modelName: fallback.modelName,
        denialCode: result.denialCode ?? DENIAL_CODE.NVG_FALLBACK_DENIED,
        reason: result.reason ?? 'fallback endpoint failed',
        latencyMs: result.latencyMs ?? 0,
        attemptedAt: new Date().toISOString() as IsoTimestamp,
      });
    }
  }

  // No endpoint succeeded
  const inv: NvgInvocationResult = {
    success: false,
    fallbackApplied: false,
    fallbackFromTier: null,
    endpointUsed: null,
    denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
    reason: `no healthy endpoint for tier ${tier}`,
  };
  if (priorAttempts.length > 0) inv.priorAttempts = priorAttempts;
  return inv;
}
