/**
 * Transport Fallback Conformance Test — spec §38.10, §24.5.3
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DENIAL_CODE } from '../../packages/contracts/src/constants/index.js';
import type {
  ModelEndpoint,
  NvgOutboundRequest,
  NvgClassificationResult,
  NvgTransportContext,
} from '@nexus/contracts';
import { ModelTransportAdapterRegistry } from '../../packages/vanguard/src/transport/registry.js';
import { OllamaChatV1Adapter } from '../../packages/vanguard/src/transport/adapters/ollama-chat-v1.js';
import { TierRegistry } from '../../packages/vanguard/src/router/tier-registry.js';
import { invokeModel } from '../../packages/vanguard/src/router/model-router.js';

function makeRequest(): NvgOutboundRequest {
  return {
    requestId: '00000000-0000-0000-0000-000000000001' as NvgOutboundRequest['requestId'],
    runId: '00000000-0000-0000-0000-000000000002' as NvgOutboundRequest['runId'],
    actorId: '00000000-0000-0000-0000-000000000003' as NvgOutboundRequest['actorId'],
    octLevel: 'OCT-OPEN' as NvgOutboundRequest['octLevel'],
    environmentContext: 'development' as NvgOutboundRequest['environmentContext'],
    taskIntent: 'fallback test' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'hello' }],
    dataLabels: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
  };
}

function makeEndpoint(id: string, tier: string): ModelEndpoint {
  return {
    endpointId: id as ModelEndpoint['endpointId'],
    tier: tier as ModelEndpoint['tier'],
    url: 'http://localhost:11434/api/chat' as ModelEndpoint['url'],
    adapterId: 'ollama-chat-v1' as ModelEndpoint['adapterId'],
    modelName: 'llama3.2' as ModelEndpoint['modelName'],
    auth: { kind: 'none' as const },
    healthy: true,
    lastCheckAt: new Date().toISOString() as ModelEndpoint['lastCheckAt'],
  };
}

function makeClassification(dataClass: string = 'general'): NvgClassificationResult {
  return {
    effectiveDataClass: dataClass as NvgClassificationResult['effectiveDataClass'],
    isSensitive: dataClass !== 'general',
    labels: [],
    classifiedAt: new Date().toISOString() as NvgClassificationResult['classifiedAt'],
  };
}

function makeContext(): NvgTransportContext {
  const reg = new ModelTransportAdapterRegistry();
  reg.register(new OllamaChatV1Adapter());
  return {
    registry: reg,
    secretSource: { canResolve: async () => true, resolve: async () => 'stub' },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Transport Fallback Law (§24.5.3)', () => {
  it('primary success: no fallback triggered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"model":"x"}', { status: 200 }))
    );
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('primary-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('fallback-1', 'fallback'));
    const r = await invokeModel(
      'on_prem_general',
      'fallback',
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(true);
    expect(r.fallbackApplied).toBe(false);
    expect(r.endpointUsed!.endpointId).toBe('primary-1');
  });

  it('primary timeout → fallback success', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(new Response('{"model":"x"}', { status: 200 }))
    );
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('primary-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('fallback-1', 'fallback'));
    const r = await invokeModel(
      'on_prem_general',
      'fallback',
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(true);
    expect(r.fallbackApplied).toBe(true);
    expect(r.fallbackFromTier).toBe('on_prem_general');
    expect(r.endpointUsed!.endpointId).toBe('fallback-1');
  });

  it('both primary and fallback fail → all exhausted', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('primary-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('fallback-1', 'fallback'));
    const r = await invokeModel(
      'on_prem_general',
      'fallback',
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.priorAttempts).toHaveLength(2);
  });

  it('fallback denied: sensitive data + frontier tier', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('primary-1', 'on_prem_sensitive'));
    tr.registerEndpoint(makeEndpoint('fallback-1', 'frontier_general'));
    const r = await invokeModel(
      'on_prem_sensitive',
      'frontier_general',
      makeRequest(),
      makeClassification('pii'),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.denialCode).toBe(DENIAL_CODE.NVG_FALLBACK_DENIED);
    expect(r.fallbackApplied).toBe(false);
  });

  it('no fallback tier → no fallback attempted', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('primary-1', 'on_prem_general'));
    const r = await invokeModel(
      'on_prem_general',
      null,
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.priorAttempts).toHaveLength(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
