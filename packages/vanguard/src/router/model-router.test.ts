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
        configSchema: { parse: (v: unknown) => v } as any,
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
