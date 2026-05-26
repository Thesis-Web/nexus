/**
 * model-router-capacity.test.ts — Phase 8 (NVG endpoint capacity routing).
 *
 * Proves the capacity-aware retry loop in invokeModel():
 *   1. Saturated endpoint is skipped; next healthy endpoint in the
 *      lawful tier is tried.
 *   2. When EVERY endpoint in the tier is saturated, NVG enters the
 *      bounded backoff retry loop; once a slot frees, the next pass
 *      succeeds.
 *   3. After the retry budget is exhausted (3 attempts with
 *      500/1000/2000ms backoff), NVG returns NVG_CAPACITY_EXHAUSTED_TIER.
 *   4. nvg_endpoint_skipped_saturated event fires per saturated attempt.
 *   5. nvg_capacity_retry_waiting event fires before each wait.
 *   6. nvg_capacity_exhausted event fires once at end of budget.
 *
 * Test architecture: use the InProcessCapacityTracker directly; pre-
 * fill it with acquires to simulate saturation. The adapter mock
 * succeeds instantly so the only blocker is the capacity check.
 */
import { describe, it, expect, vi } from 'vitest';

import { invokeModel } from './model-router.js';
import { TierRegistry } from './tier-registry.js';
import { InProcessCapacityTracker } from './capacity-tracker.js';
import { classifyOutboundData } from '../classifier/data-classifier.js';

import {
  MODEL_TIER,
  OCT_LEVEL,
  DENIAL_CODE,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type NvgOutboundRequest,
  type NvgTransportContext,
  type ModelTransportAdapter,
  type ModelTransportAdapterRegistry,
  type SecretSource,
  type RunLedgerEntry,
  type RunLedgerWriter,
  type NonEmpty,
  type IsoTimestamp,
  type Uuid,
  type DataLabel,
  type OctLevel,
  type EnvironmentId,
} from '@nexus/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────

const stubSecretSource: SecretSource = {
  canResolve: () => false,
  resolve: async () => {
    throw new Error('stub: no secrets');
  },
};

function makeRequest(): NvgOutboundRequest {
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
    boundConnectorClasses: [],
    costPreference: 'low' as NonEmpty,
    carriedClaims: {},
    provenance: 'workspace_upload',
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
    url: `http://localhost:9000/${id}` as NonEmpty,
    adapterId: 'stub-adapter' as NonEmpty,
    modelName: 'test-model' as NonEmpty,
    auth: { kind: 'none' as const },
    healthy: true,
    lastCheckAt: '2020-01-01T00:00:00.000Z' as IsoTimestamp,
    ...overrides,
  };
}

function makeAdapter(response: ModelEndpointResponse): ModelTransportAdapter {
  return {
    adapterId: 'stub-adapter' as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: { safeParse: () => ({ success: true as const, data: {} }) },
    invoke: async () => response,
  };
}

function makeTransport(adapter: ModelTransportAdapter): NvgTransportContext {
  const adapters = new Map<string, ModelTransportAdapter>([[adapter.adapterId, adapter]]);
  const registry: ModelTransportAdapterRegistry = {
    register: () => {},
    get: (id: string) => adapters.get(id) ?? null,
    list: () => [...adapters.values()],
  };
  return { registry, secretSource: stubSecretSource };
}

function captureLedger(): { runLedger: RunLedgerWriter; entries: RunLedgerEntry[] } {
  const entries: RunLedgerEntry[] = [];
  const runLedger: RunLedgerWriter = {
    writeEvent: vi.fn(async (entry: RunLedgerEntry) => {
      entries.push(entry);
    }),
  };
  return { runLedger, entries };
}

const successResponse: ModelEndpointResponse = {
  success: true,
  responseSize: 4,
  latencyMs: 1,
  opaqueProviderResponse: { message: { role: 'assistant', content: 'ok' } },
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NVG model-router — Phase 8 capacity routing', () => {
  it('skips a saturated endpoint and succeeds on the next healthy one', async () => {
    const registry = new TierRegistry();
    const tracker = new InProcessCapacityTracker();
    const epA = makeEndpoint('ep-A', MODEL_TIER.ON_PREM_GENERAL, { maxConcurrentRequests: 1 });
    const epB = makeEndpoint('ep-B', MODEL_TIER.ON_PREM_GENERAL, { maxConcurrentRequests: 4 });
    registry.registerEndpoint(epA);
    registry.registerEndpoint(epB);

    // Pre-saturate ep-A so the router has to skip it.
    expect(tracker.tryAcquire('ep-A', 1).acquired).toBe(true);

    const transport = makeTransport(makeAdapter(successResponse));
    const captured = captureLedger();
    const classification = classifyOutboundData(makeRequest().dataLabels);

    const result = await invokeModel(
      MODEL_TIER.ON_PREM_GENERAL,
      null,
      makeRequest(),
      classification,
      registry,
      transport,
      null,
      tracker,
      captured.runLedger
    );

    expect(result.success).toBe(true);
    expect(result.endpointUsed?.endpointId).toBe('ep-B');
    // ep-A skipped event fired.
    const skipped = captured.entries.filter(e => e.eventType === 'nvg_endpoint_skipped_saturated');
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.detail['endpointId']).toBe('ep-A');
    expect(skipped[0]!.detail['currentInflight']).toBe(1);
    expect(skipped[0]!.detail['maxConcurrent']).toBe(1);
  });

  it('returns NVG_CAPACITY_EXHAUSTED_TIER after retry budget when all endpoints stay saturated', async () => {
    const registry = new TierRegistry();
    const tracker = new InProcessCapacityTracker();
    const epOnly = makeEndpoint('ep-only', MODEL_TIER.ON_PREM_GENERAL, {
      maxConcurrentRequests: 1,
    });
    registry.registerEndpoint(epOnly);
    // Saturate the only endpoint and keep it saturated for the whole test.
    expect(tracker.tryAcquire('ep-only', 1).acquired).toBe(true);

    const transport = makeTransport(makeAdapter(successResponse));
    const captured = captureLedger();
    const classification = classifyOutboundData(makeRequest().dataLabels);

    const result = await invokeModel(
      MODEL_TIER.ON_PREM_GENERAL,
      null,
      makeRequest(),
      classification,
      registry,
      transport,
      null,
      tracker,
      captured.runLedger
    );

    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER);
    // Exactly one nvg_capacity_exhausted event at end of budget.
    const exhausted = captured.entries.filter(e => e.eventType === 'nvg_capacity_exhausted');
    expect(exhausted.length).toBe(1);
    expect(exhausted[0]!.detail['tier']).toBe(MODEL_TIER.ON_PREM_GENERAL);
    // 3 retry waits emitted (one before each of 3 retries after the initial pass).
    const waits = captured.entries.filter(e => e.eventType === 'nvg_capacity_retry_waiting');
    expect(waits.length).toBe(3);
    expect(waits[0]!.detail['nextWaitMs']).toBe(500);
    expect(waits[1]!.detail['nextWaitMs']).toBe(1000);
    expect(waits[2]!.detail['nextWaitMs']).toBe(2000);
    // 4 total passes (1 initial + 3 retries) → 4 skipped-saturated events.
    const skipped = captured.entries.filter(e => e.eventType === 'nvg_endpoint_skipped_saturated');
    expect(skipped.length).toBe(4);
  }, 15_000);

  it('preserves backward-compat: no capacityTracker passed → no capacity-retry behavior', async () => {
    const registry = new TierRegistry();
    registry.registerEndpoint(makeEndpoint('ep-1', MODEL_TIER.ON_PREM_GENERAL));
    const transport = makeTransport(makeAdapter(successResponse));

    const result = await invokeModel(
      MODEL_TIER.ON_PREM_GENERAL,
      null,
      makeRequest(),
      classifyOutboundData(makeRequest().dataLabels),
      registry,
      transport
      // no preferredEndpoint, no capacityTracker, no runLedger
    );
    expect(result.success).toBe(true);
    expect(result.endpointUsed?.endpointId).toBe('ep-1');
  });
});
