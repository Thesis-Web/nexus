/**
 * WIRE-003 Proof Tests — model-router health update wiring
 *
 * Verifies that invokeModel() calls registry.updateEndpointHealth() after
 * every callEndpoint() result:
 *   1. Succeeding endpoint is marked healthy (lastCheckAt updated)
 *   2. Failing endpoint is marked unhealthy
 *   3. Next invocation excludes unhealthy endpoint via getHealthyEndpoints()
 *
 * spec §24.5, blueprint §13.6
 */
import { describe, it, expect } from 'vitest';

import { invokeModel } from './model-router.js';
import { TierRegistry } from './tier-registry.js';
import { classifyOutboundData } from '../classifier/data-classifier.js';

import {
  MODEL_TIER,
  OCT_LEVEL,
  DENIAL_CODE,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type NvgOutboundRequest,
  type NvgTransportContext,
  type ModelTransportAdapterRegistry,
  type ModelTransportAdapter,
  type SecretSource,
  type NonEmpty,
  type IsoTimestamp,
  type Uuid,
  type Base64Url,
  type DataLabel,
  type OctLevel,
  type EnvironmentId,
} from '@nexus/contracts';

// ── Test helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<NvgOutboundRequest> = {}): NvgOutboundRequest {
  return {
    runId: crypto.randomUUID() as Uuid,
    actorId: 'actor-test' as NonEmpty,
    principalId: 'principal-test' as NonEmpty,
    sessionId: 'session-test' as NonEmpty,
    environmentId: 'env-test' as EnvironmentId,
    octLevel: OCT_LEVEL.OPEN as OctLevel,
    taskIntent: 'summarize' as NonEmpty,
    dataLabels: [
      {
        labelId: 'lbl-1' as NonEmpty,
        dataClass: 'public' as NonEmpty,
        provenance: 'operator' as NonEmpty,
        confidence: 1.0,
      } as DataLabel,
    ],
    costPreference: 'low' as NonEmpty,
    ...overrides,
  };
}

function makeEndpoint(
  id: string,
  tier: string,
  overrides: Partial<ModelEndpoint> = {}
): ModelEndpoint {
  return {
    endpointId: id as NonEmpty,
    tier: tier as NonEmpty,
    url: `http://localhost:${9000 + Math.floor(Math.random() * 1000)}` as NonEmpty,
    adapterId: 'stub-adapter' as NonEmpty,
    modelName: 'test-model' as NonEmpty,
    auth: { kind: 'none' as const },
    healthy: true,
    lastCheckAt: '2020-01-01T00:00:00.000Z' as IsoTimestamp,
    ...overrides,
  };
}

/** Stub SecretSource — tests don't resolve real secrets. */
const stubSecretSource: SecretSource = {
  canResolve: () => false,
  resolve: async () => {
    throw new Error('stub: no secrets');
  },
};

/**
 * Create a mock ModelTransportAdapter that returns a fixed response.
 */
function makeMockAdapter(
  adapterId: string,
  response: ModelEndpointResponse
): ModelTransportAdapter {
  return {
    adapterId: adapterId as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: {
      safeParse: () => ({ success: true as const, data: {} }),
    },
    invoke: async () => response,
  };
}

/**
 * Create a mock ModelTransportAdapterRegistry from a map of adapterId → adapter.
 */
function makeMockRegistry(
  adapters: Map<string, ModelTransportAdapter>
): ModelTransportAdapterRegistry {
  return {
    register: () => {},
    get: (id: string) => adapters.get(id) ?? null,
    list: () => [...adapters.values()],
  };
}

/**
 * Create a NvgTransportContext with mock adapters.
 */
function makeMockTransportContext(
  adapterMap: Map<string, ModelTransportAdapter>
): NvgTransportContext {
  return {
    registry: makeMockRegistry(adapterMap),
    secretSource: stubSecretSource,
  };
}

// ── WIRE-003 Proof Tests ─────────────────────────────────────────────────

// T6-F03 FIX: transportContext is now mandatory. Use a fixture adapter that returns success.
const fixtureStubTransport = makeMockTransportContext(
  new Map<string, ModelTransportAdapter>([
    [
      'fixture-adapter',
      {
        adapterId: 'fixture-adapter' as NonEmpty,
        adapterVersion: 'v0.0.1' as NonEmpty,
        // Structural AdapterConfigSchema — `safeParse` is the contract; a
        // pass-through schema is fine for tests that don't exercise config.
        configSchema: { safeParse: () => ({ success: true as const, data: {} }) },
        async invoke() {
          return { success: true, responseSize: 0, latencyMs: 1 };
        },
      },
    ],
  ])
);

describe('WIRE-003: invokeModel health update wiring (§24.5, blueprint §13.6)', () => {
  it('marks succeeding endpoint healthy with updated lastCheckAt', async () => {
    const oldTimestamp = '2020-01-01T00:00:00.000Z' as IsoTimestamp;
    const registry = new TierRegistry();
    const ep = makeEndpoint('ep-success', MODEL_TIER.FRONTIER_GENERAL, {
      // adapterId must match the fixture transport's registered adapter,
      // otherwise callEndpoint returns NVG_TRANSPORT_UNKNOWN_ADAPTER and
      // the success path never runs.
      adapterId: 'fixture-adapter' as NonEmpty,
      healthy: true,
      lastCheckAt: oldTimestamp,
    });
    registry.registerEndpoint(ep);

    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    // T6-F03: fixtureStubTransport injected — mandatory transport context
    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      fixtureStubTransport
    );

    expect(result.success).toBe(true);

    // Verify health update was applied: lastCheckAt should be newer than 2020
    const endpoints = registry.getEndpoints(MODEL_TIER.FRONTIER_GENERAL);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.healthy).toBe(true);
    expect(endpoints[0]!.lastCheckAt).not.toBe(oldTimestamp);
    // Confirm the new timestamp is plausibly recent (within the last 10 seconds)
    const updatedAt = new Date(endpoints[0]!.lastCheckAt).getTime();
    expect(updatedAt).toBeGreaterThan(Date.now() - 10_000);
  });

  it('marks failing endpoint unhealthy', async () => {
    const registry = new TierRegistry();
    const ep = makeEndpoint('ep-fail', MODEL_TIER.FRONTIER_GENERAL, {
      adapterId: 'missing-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(ep);

    // Transport context where 'missing-adapter' is NOT registered → UNKNOWN_ADAPTER
    const transportCtx = makeMockTransportContext(new Map());

    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx
    );

    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_UNKNOWN_ADAPTER);

    // Verify health update: endpoint should now be unhealthy
    const endpoints = registry.getEndpoints(MODEL_TIER.FRONTIER_GENERAL);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.healthy).toBe(false);
  });

  it('next invocation excludes endpoint marked unhealthy by prior failure', async () => {
    const registry = new TierRegistry();

    // Two endpoints on the same tier, both healthy
    const ep1 = makeEndpoint('ep-timeout', MODEL_TIER.FRONTIER_GENERAL, {
      adapterId: 'timeout-adapter' as NonEmpty,
      healthy: true,
    });
    const ep2 = makeEndpoint('ep-ok', MODEL_TIER.FRONTIER_GENERAL, {
      adapterId: 'ok-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(ep1);
    registry.registerEndpoint(ep2);

    // Mock adapters: ep1's adapter returns retriable TIMEOUT, ep2's succeeds
    const adapterMap = new Map<string, ModelTransportAdapter>();
    adapterMap.set(
      'timeout-adapter',
      makeMockAdapter('timeout-adapter', {
        success: false,
        denialCode: DENIAL_CODE.NVG_ENDPOINT_TIMEOUT,
        reason: 'simulated timeout',
        latencyMs: 30000,
      })
    );
    adapterMap.set(
      'ok-adapter',
      makeMockAdapter('ok-adapter', {
        success: true,
        responseSize: 42,
        latencyMs: 100,
      })
    );

    const transportCtx = makeMockTransportContext(adapterMap);
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    // ── First invocation: ep1 times out (retriable) → ep2 succeeds ──
    const result1 = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx
    );

    expect(result1.success).toBe(true);
    // ep1 was tried and failed → should be in priorAttempts
    expect(result1.priorAttempts).toHaveLength(1);
    expect(result1.priorAttempts![0]!.endpointUsed).toBe('ep-timeout');
    // NVG-RPT-002: verify enriched metadata carried from ModelEndpoint
    expect(result1.priorAttempts![0]!.tier).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(result1.priorAttempts![0]!.adapterId).toBe('timeout-adapter');
    expect(result1.priorAttempts![0]!.modelName).toBe('test-model');

    // Verify: ep1 is now unhealthy, ep2 is healthy
    const healthyAfterFirst = registry.getHealthyEndpoints(MODEL_TIER.FRONTIER_GENERAL);
    expect(healthyAfterFirst).toHaveLength(1);
    expect(healthyAfterFirst[0]!.endpointId).toBe('ep-ok');

    // ── Second invocation: only ep2 is eligible ──
    const result2 = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx
    );

    expect(result2.success).toBe(true);
    // No priorAttempts — ep1 was excluded, ep2 succeeded immediately
    expect(result2.priorAttempts).toBeUndefined();
    expect(result2.endpointUsed!.endpointId).toBe('ep-ok');
  });
});

// ── BUG-3 Preferred-tier sibling logic ───────────────────────────────────
//
// CLAUDE-CODE-FIX-MODEL-PREFERENCE-ROUTING — when a user picks a specific
// endpoint and it is unhealthy (or its retriable invocation failed), the
// router must try other healthy endpoints on the SAME tier as the
// preference before dropping to the routing-policy-selected tier. The
// dropdown choice carries tier intent as well as endpoint intent.

describe('BUG-3: preferred-tier sibling fallback (CLAUDE-CODE-FIX-MODEL-PREFERENCE-ROUTING)', () => {
  it('tries same-tier sibling when preferred endpoint is unhealthy and policy tier differs', async () => {
    // Simulated clock so we can mark the preferred endpoint unhealthy and
    // keep the cooldown unfinished — the preference becomes ineligible.
    const clock = { ms: 1_000_000 };
    const registry = new TierRegistry({ now: () => clock.ms });

    const preferred = makeEndpoint('ep-preferred', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'never-called' as NonEmpty,
      healthy: true,
    });
    const sibling = makeEndpoint('ep-sibling-onprem', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'sibling-adapter' as NonEmpty,
      healthy: true,
    });
    const policyEndpoint = makeEndpoint('ep-frontier', MODEL_TIER.FRONTIER_GENERAL, {
      adapterId: 'frontier-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(preferred);
    registry.registerEndpoint(sibling);
    registry.registerEndpoint(policyEndpoint);

    // Mark the preferred endpoint unhealthy 5 seconds ago — well inside
    // the default 60s cooldown so it stays ineligible for invocation.
    registry.updateEndpointHealth(
      'ep-preferred' as NonEmpty,
      false,
      new Date().toISOString() as IsoTimestamp
    );

    const adapters = new Map<string, ModelTransportAdapter>([
      [
        'sibling-adapter',
        makeMockAdapter('sibling-adapter', {
          success: true,
          responseSize: 11,
          latencyMs: 5,
        }),
      ],
      [
        'frontier-adapter',
        makeMockAdapter('frontier-adapter', {
          success: true,
          responseSize: 22,
          latencyMs: 5,
        }),
      ],
    ]);
    const transportCtx = makeMockTransportContext(adapters);
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    // Policy picks FRONTIER_GENERAL. Preference is on ON_PREM_GENERAL.
    // Sibling on ON_PREM_GENERAL is healthy → it must be chosen, NOT
    // the policy tier's frontier endpoint.
    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx,
      preferred
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed!.endpointId).toBe('ep-sibling-onprem');
    expect(result.endpointUsed!.tier).toBe(MODEL_TIER.ON_PREM_GENERAL);
  });

  it('falls through to policy tier when preferred tier has no healthy siblings', async () => {
    const registry = new TierRegistry();

    // Preferred endpoint on tier A, no siblings on tier A. Policy tier B
    // has a healthy endpoint — that's what should run.
    const preferred = makeEndpoint('ep-only-onprem', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'unreachable-adapter' as NonEmpty,
      healthy: false, // unhealthy AND no cooldown entry → not eligible
    });
    const policyEndpoint = makeEndpoint('ep-frontier', MODEL_TIER.FRONTIER_GENERAL, {
      adapterId: 'frontier-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(preferred);
    registry.registerEndpoint(policyEndpoint);

    const transportCtx = makeMockTransportContext(
      new Map<string, ModelTransportAdapter>([
        [
          'frontier-adapter',
          makeMockAdapter('frontier-adapter', {
            success: true,
            responseSize: 7,
            latencyMs: 5,
          }),
        ],
      ])
    );
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx,
      preferred
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed!.endpointId).toBe('ep-frontier');
    expect(result.endpointUsed!.tier).toBe(MODEL_TIER.FRONTIER_GENERAL);
  });

  it('does NOT double-invoke when preferred tier matches policy tier', async () => {
    // Preferred on tier A, policy tier = A (same). The existing same-tier
    // retry below the new block already covers siblings — the new block
    // must not run, otherwise we'd hit each sibling twice.
    const registry = new TierRegistry();
    const preferred = makeEndpoint('ep-pref', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'never-called' as NonEmpty,
      healthy: false, // unhealthy, no cooldown entry → ineligible
    });
    const sibling = makeEndpoint('ep-sib', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'sibling-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(preferred);
    registry.registerEndpoint(sibling);

    const siblingAdapter = makeMockAdapter('sibling-adapter', {
      success: true,
      responseSize: 3,
      latencyMs: 2,
    });
    let invokeCount = 0;
    const wrappedAdapter: ModelTransportAdapter = {
      ...siblingAdapter,
      async invoke(endpoint, req, secrets) {
        invokeCount++;
        return siblingAdapter.invoke(endpoint, req, secrets);
      },
    };
    const transportCtx = makeMockTransportContext(
      new Map<string, ModelTransportAdapter>([['sibling-adapter', wrappedAdapter]])
    );
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    const result = await invokeModel(
      MODEL_TIER.ON_PREM_GENERAL, // policy tier == preferred tier
      null,
      request,
      classification,
      registry,
      transportCtx,
      preferred
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed!.endpointId).toBe('ep-sib');
    expect(invokeCount).toBe(1);
  });

  it('preference healthy → invoked directly, no sibling attempts', async () => {
    const registry = new TierRegistry();
    const preferred = makeEndpoint('ep-pref', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'pref-adapter' as NonEmpty,
      healthy: true,
    });
    const sibling = makeEndpoint('ep-sib', MODEL_TIER.ON_PREM_GENERAL, {
      adapterId: 'sib-adapter' as NonEmpty,
      healthy: true,
    });
    registry.registerEndpoint(preferred);
    registry.registerEndpoint(sibling);

    let prefCalls = 0;
    let sibCalls = 0;
    const transportCtx = makeMockTransportContext(
      new Map<string, ModelTransportAdapter>([
        [
          'pref-adapter',
          {
            ...makeMockAdapter('pref-adapter', { success: true, latencyMs: 1 }),
            async invoke() {
              prefCalls++;
              return { success: true, responseSize: 1, latencyMs: 1 };
            },
          },
        ],
        [
          'sib-adapter',
          {
            ...makeMockAdapter('sib-adapter', { success: true, latencyMs: 1 }),
            async invoke() {
              sibCalls++;
              return { success: true, responseSize: 1, latencyMs: 1 };
            },
          },
        ],
      ])
    );
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx,
      preferred
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed!.endpointId).toBe('ep-pref');
    expect(prefCalls).toBe(1);
    expect(sibCalls).toBe(0);
  });

  it('Auto (preferredEndpoint=null) preserves policy-tier behavior unchanged', async () => {
    const registry = new TierRegistry();
    registry.registerEndpoint(
      makeEndpoint('ep-frontier', MODEL_TIER.FRONTIER_GENERAL, {
        adapterId: 'frontier-adapter' as NonEmpty,
        healthy: true,
      })
    );
    registry.registerEndpoint(
      makeEndpoint('ep-onprem', MODEL_TIER.ON_PREM_GENERAL, {
        adapterId: 'onprem-adapter' as NonEmpty,
        healthy: true,
      })
    );

    const transportCtx = makeMockTransportContext(
      new Map<string, ModelTransportAdapter>([
        [
          'frontier-adapter',
          makeMockAdapter('frontier-adapter', { success: true, responseSize: 1, latencyMs: 1 }),
        ],
        [
          'onprem-adapter',
          makeMockAdapter('onprem-adapter', { success: true, responseSize: 1, latencyMs: 1 }),
        ],
      ])
    );
    const request = makeRequest();
    const classification = classifyOutboundData(request.dataLabels);

    // No preferredEndpoint → policy tier is the only path.
    const result = await invokeModel(
      MODEL_TIER.FRONTIER_GENERAL,
      null,
      request,
      classification,
      registry,
      transportCtx,
      null
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed!.endpointId).toBe('ep-frontier');
  });
});
