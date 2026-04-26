/**
 * Transport Same-Tier Retry Conformance Test — spec §38.10, §24.5.3
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
    taskIntent: 'retry test' as NvgOutboundRequest['taskIntent'],
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

function makeClassification(): NvgClassificationResult {
  return {
    effectiveDataClass: 'general' as NvgClassificationResult['effectiveDataClass'],
    isSensitive: false,
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

describe('Transport Same-Tier Retry (§24.5.3)', () => {
  it('first timeout, second success → success with priorAttempts', async () => {
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
    tr.registerEndpoint(makeEndpoint('ep-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('ep-2', 'on_prem_general'));
    const r = await invokeModel(
      'on_prem_general',
      null,
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(true);
    expect(r.endpointUsed!.endpointId).toBe('ep-2');
    expect(r.priorAttempts).toHaveLength(1);
    expect(r.priorAttempts![0].endpointUsed).toBe('ep-1');
    expect(r.priorAttempts![0].denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
  });

  it('both timeout → all exhausted', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('ep-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('ep-2', 'on_prem_general'));
    const r = await invokeModel(
      'on_prem_general',
      null,
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.priorAttempts).toHaveLength(2);
    expect(r.priorAttempts![0].endpointUsed).toBe('ep-1');
    expect(r.priorAttempts![1].endpointUsed).toBe('ep-2');
  });

  it('non-retriable failure (auth_failed) → immediate return, no retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"no"}', { status: 401 }))
    );
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('ep-1', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('ep-2', 'on_prem_general'));
    const r = await invokeModel(
      'on_prem_general',
      null,
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(r.priorAttempts).toBeUndefined();
  });

  it('all primaries attempted in manifest order', async () => {
    const err = new Error('timeout');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const tr = new TierRegistry();
    tr.registerEndpoint(makeEndpoint('first', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('second', 'on_prem_general'));
    tr.registerEndpoint(makeEndpoint('third', 'on_prem_general'));
    const r = await invokeModel(
      'on_prem_general',
      null,
      makeRequest(),
      makeClassification(),
      tr,
      makeContext()
    );
    expect(r.success).toBe(false);
    expect(r.priorAttempts).toHaveLength(3);
    expect(r.priorAttempts![0].endpointUsed).toBe('first');
    expect(r.priorAttempts![1].endpointUsed).toBe('second');
    expect(r.priorAttempts![2].endpointUsed).toBe('third');
  });
});
