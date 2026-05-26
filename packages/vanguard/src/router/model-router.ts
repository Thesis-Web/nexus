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
  type RunLedgerWriter,
} from '@nexus/contracts';
import type { TierRegistry } from './tier-registry.js';
import type { CapacityTracker } from './capacity-tracker.js';

/**
 * Denial codes that trigger same-tier retry and cross-tier fallback (§24.5.3).
 * Auth, config, and parse errors are NOT retriable — they would repeat.
 * Typed as Set<string> because DenialCode is string (open governed type).
 *
 * Phase 8 — NVG_CAPACITY_EXHAUSTED_TIER is included so a saturated
 * endpoint is treated like any other retriable failure: the router
 * tries the next healthy endpoint in the lawful tier. The OUTER capacity
 * retry loop (in invokeModel below) handles the wait-then-retry case
 * when EVERY endpoint in the tier was saturated.
 */
const FALLBACK_TRIGGERING_CODES: Set<string> = new Set([
  DENIAL_CODE.NVG_ENDPOINT_TIMEOUT,
  DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
  DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED,
  DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR,
  DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER,
]);

/**
 * Phase 8 capacity-retry budget. The outer retry loop in invokeModel
 * waits these many milliseconds between passes when EVERY endpoint in
 * the lawful tier was saturated on the previous pass. After the budget
 * is exhausted, NVG returns NVG_CAPACITY_EXHAUSTED_TIER. The orchestrator
 * does NOT retry capacity exhaustion — NVG owns the whole capacity loop
 * (Q4 ruling 2026-05-26; manifold-arc note: NVG, not orch, owns this).
 */
const CAPACITY_RETRY_BACKOFF_MS: ReadonlyArray<number> = [500, 1000, 2000];

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
 * Phase 8 — capacity-gated callEndpoint wrapper.
 *
 * Wraps `callEndpoint` with an in-flight reservation against the supplied
 * `CapacityTracker`. When the endpoint is at `maxConcurrentRequests`, the
 * adapter is NOT invoked; instead the wrapper synthesizes a retriable
 * `NVG_CAPACITY_EXHAUSTED_TIER` response so the existing
 * FALLBACK_TRIGGERING_CODES path skips this endpoint and tries the next
 * one. When acquired, the slot is released in a `finally` so adapter
 * exceptions don't leak capacity.
 *
 * Emits `nvg_endpoint_skipped_saturated` to the run ledger (which
 * automatically fans out via SSE to the workspace stream) when the
 * acquire fails — gives the live UX a "models busy" signal.
 */
async function callEndpointWithCapacity(
  endpoint: ModelEndpoint,
  request: NvgOutboundRequest,
  transportContext: NvgTransportContext,
  capacityTracker: CapacityTracker,
  runLedger: RunLedgerWriter | null
): Promise<ModelEndpointResponse> {
  const acquire = capacityTracker.tryAcquire(endpoint.endpointId, endpoint.maxConcurrentRequests);
  if (!acquire.acquired) {
    if (runLedger) {
      await runLedger.writeEvent({
        runId: request.runId,
        eventType: 'nvg_endpoint_skipped_saturated',
        timestamp: new Date().toISOString() as IsoTimestamp,
        actorId: request.actorId,
        detail: {
          endpointId: endpoint.endpointId,
          tier: endpoint.tier,
          currentInflight: acquire.currentInflight,
          maxConcurrent: acquire.maxConcurrent,
        },
      });
    }
    return {
      success: false,
      denialCode: DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER,
      reason: `endpoint ${endpoint.endpointId} at capacity (${acquire.currentInflight}/${acquire.maxConcurrent})`,
      latencyMs: 0,
    };
  }
  try {
    return await callEndpoint(endpoint, request, transportContext);
  } finally {
    capacityTracker.release(endpoint.endpointId);
  }
}

/**
 * Phase 8 — determine the `healthy` flag to feed into
 * `registry.updateEndpointHealth`. Capacity exhaustion is NOT an endpoint
 * health failure — the endpoint is fine, just busy. Marking it unhealthy
 * would push it into the cooldown probation cycle and starve the retry
 * loop. Returns `true` for both success AND capacity-exhausted; `false`
 * only for real transport / config / auth failures.
 */
function endpointHealthyAfter(result: ModelEndpointResponse): boolean {
  if (result.success) return true;
  if (result.denialCode === DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER) return true;
  return false;
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
  preferredEndpoint: ModelEndpoint | null = null,
  capacityTracker: CapacityTracker | null = null,
  runLedger: RunLedgerWriter | null = null
): Promise<NvgInvocationResult> {
  // Phase 8 — capacity-aware retry loop (Q4 ruling: NVG owns the retry,
  // not orch). When capacityTracker is provided, wrap a single pass of
  // the existing routing logic in up to CAPACITY_RETRY_BACKOFF_MS.length
  // re-attempts; we only re-attempt when EVERY endpoint in the lawful
  // tier returned NVG_CAPACITY_EXHAUSTED_TIER. Real failures + successes
  // exit the loop immediately. When capacityTracker is null, the loop
  // runs exactly once (backward-compat with existing tests that don't
  // pass it).
  if (capacityTracker !== null) {
    for (
      let attemptIndex = 0;
      attemptIndex < CAPACITY_RETRY_BACKOFF_MS.length + 1;
      attemptIndex++
    ) {
      const result = await invokeModelOnce(
        tier,
        fallbackTier,
        request,
        classification,
        registry,
        transportContext,
        preferredEndpoint,
        capacityTracker,
        runLedger
      );
      // If this pass produced ANY success → done.
      if (result.success) return result;
      // If this pass produced a non-capacity denial (real failure / fallback
      // denied) → done; capacity retry only applies to capacity exhaustion.
      const wasCapacityExhausted =
        result.denialCode === DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER ||
        (result.priorAttempts !== undefined &&
          result.priorAttempts.length > 0 &&
          result.priorAttempts.every(
            a => a.denialCode === DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER
          ));
      if (!wasCapacityExhausted) return result;
      // Last pass — return capacity-exhausted denial as final.
      if (attemptIndex >= CAPACITY_RETRY_BACKOFF_MS.length) {
        if (runLedger) {
          await runLedger.writeEvent({
            runId: request.runId,
            eventType: 'nvg_capacity_exhausted',
            timestamp: new Date().toISOString() as IsoTimestamp,
            actorId: request.actorId,
            detail: {
              tier,
              totalAttempts: attemptIndex + 1,
              priorAttemptCount: result.priorAttempts?.length ?? 0,
            },
          });
        }
        return {
          ...result,
          denialCode: DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER,
          reason: `all endpoints in tier ${tier} saturated after ${attemptIndex + 1} attempts`,
        };
      }
      // Wait before next attempt; emit a busy-waiting event so the
      // workspace SSE stream can render a countdown.
      const nextWaitMs = CAPACITY_RETRY_BACKOFF_MS[attemptIndex]!;
      if (runLedger) {
        const endpointsAtCapacity = (result.priorAttempts ?? [])
          .filter(a => a.denialCode === DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER)
          .map(a => a.endpointUsed);
        await runLedger.writeEvent({
          runId: request.runId,
          eventType: 'nvg_capacity_retry_waiting',
          timestamp: new Date().toISOString() as IsoTimestamp,
          actorId: request.actorId,
          detail: {
            tier,
            attemptIndex,
            nextWaitMs,
            endpointsAtCapacity,
          },
        });
      }
      await new Promise(resolve => setTimeout(resolve, nextWaitMs));
    }
  }

  // No capacity tracker (backward-compat) — single pass.
  return invokeModelOnce(
    tier,
    fallbackTier,
    request,
    classification,
    registry,
    transportContext,
    preferredEndpoint,
    null,
    null
  );
}

/**
 * One pass of the existing route → invoke → fallback chain, optionally
 * gated by capacityTracker. Extracted so the outer invokeModel can wrap
 * it in the capacity retry loop without duplicating the body.
 */
async function invokeModelOnce(
  tier: ModelTier,
  fallbackTier: ModelTier | null,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult,
  registry: TierRegistry,
  transportContext: NvgTransportContext,
  preferredEndpoint: ModelEndpoint | null,
  capacityTracker: CapacityTracker | null,
  runLedger: RunLedgerWriter | null
): Promise<NvgInvocationResult> {
  const call = capacityTracker
    ? (ep: ModelEndpoint): Promise<ModelEndpointResponse> =>
        callEndpointWithCapacity(ep, request, transportContext, capacityTracker, runLedger)
    : (ep: ModelEndpoint): Promise<ModelEndpointResponse> =>
        callEndpoint(ep, request, transportContext);
  const priorAttempts: InvocationAttempt[] = [];

  // ── Preference-first attempt (§3 case 1c) ──
  // Caller has already verified ceiling allows the preferred tier; we only
  // need to gate on liveness (healthy or probationary).
  if (preferredEndpoint !== null && registry.isEndpointEligible(preferredEndpoint)) {
    const result = await call(preferredEndpoint);
    registry.updateEndpointHealth(
      preferredEndpoint.endpointId,
      endpointHealthyAfter(result),
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
  } else if (preferredEndpoint !== null) {
    // CLAUDE-CODE-MODEL-PREFERENCE-TRANSPARENCY §2 — the preferred endpoint
    // exists in the registry but is currently ineligible (unhealthy and not
    // yet probationary). The previous behavior was to silently fall through
    // to the sibling/policy chain with no audit footprint — operators had no
    // way to tell from the trail that the user's preference was even
    // considered. Push a synthetic priorAttempt so the routing trail and
    // run-ledger completionMetadata both expose the skip.
    //
    // NVG_ENDPOINT_UNREACHABLE is the closest existing retriable code; the
    // `reason` distinguishes the "endpoint not invoked, in cooldown" case
    // from an actual network failure.
    priorAttempts.push({
      endpointUsed: preferredEndpoint.endpointId,
      tier: preferredEndpoint.tier,
      adapterId: preferredEndpoint.adapterId,
      modelName: preferredEndpoint.modelName,
      denialCode: DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
      reason: 'preferred_endpoint_ineligible',
      latencyMs: 0,
      attemptedAt: new Date().toISOString() as IsoTimestamp,
    });
  }

  // ── Preferred-tier siblings (CLAUDE-CODE-FIX-MODEL-PREFERENCE-ROUTING §3) ──
  //
  // BUG-3: when the user picks a specific endpoint and it is unhealthy
  // (eligibility=false) or its retriable invocation failed above, the
  // dropdown choice carries TIER intent as well as endpoint intent. Try
  // healthy siblings on the preferred tier BEFORE dropping to the policy-
  // selected tier — silently jumping tiers on a transient endpoint outage
  // is a governance surprise.
  //
  // Skipped when preferredTier === policy `tier`: the same-tier retry block
  // below already covers those siblings (preferredEndpoint is filtered out
  // there to avoid double-calling).
  if (preferredEndpoint !== null && preferredEndpoint.tier !== tier) {
    const sameTierSiblings = registry
      .getHealthyEndpoints(preferredEndpoint.tier)
      .filter(e => e.endpointId !== preferredEndpoint.endpointId);

    for (const sibling of sameTierSiblings) {
      const result = await call(sibling);
      registry.updateEndpointHealth(
        sibling.endpointId,
        endpointHealthyAfter(result),
        new Date().toISOString() as IsoTimestamp
      );

      if (result.success) {
        // Same tier as the user's preference, different endpoint — tier
        // intent honored even though the specific endpoint wasn't used.
        // The route-trail records `priorAttempts` so operators can see
        // why the preferred endpoint was skipped.
        return buildInvocationResult(result, sibling, false, null, priorAttempts);
      }

      const denialCode = result.denialCode ?? DENIAL_CODE.NVG_FALLBACK_DENIED;
      if (!FALLBACK_TRIGGERING_CODES.has(denialCode)) {
        // Non-retriable on a sibling (auth/config/parse) — surface it
        // immediately. Continuing through the rest of the chain would
        // mask a real misconfiguration.
        return buildInvocationResult(result, sibling, false, null, priorAttempts);
      }

      priorAttempts.push({
        endpointUsed: sibling.endpointId,
        tier: sibling.tier,
        adapterId: sibling.adapterId,
        modelName: sibling.modelName,
        denialCode,
        reason: result.reason ?? 'preferred_tier_sibling_failed',
        latencyMs: result.latencyMs ?? 0,
        attemptedAt: new Date().toISOString() as IsoTimestamp,
      });
    }
  }

  // ── Same-tier retry: try ALL healthy primary endpoints in manifest order ──
  const primaryEndpoints = registry.getHealthyEndpoints(tier).filter(
    // Already attempted above — skip to avoid double-call when policy tier
    // happens to contain the preference.
    e => preferredEndpoint === null || e.endpointId !== preferredEndpoint.endpointId
  );
  for (const primary of primaryEndpoints) {
    const result = await call(primary);

    // WIRE-003: update health state after every transport call
    registry.updateEndpointHealth(
      primary.endpointId,
      endpointHealthyAfter(result),
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
      const result = await call(fallback);

      // WIRE-003: update health state after every transport call
      registry.updateEndpointHealth(
        fallback.endpointId,
        endpointHealthyAfter(result),
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
