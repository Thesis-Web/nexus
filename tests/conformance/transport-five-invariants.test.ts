/**
 * Transport Five Invariants Conformance Test — spec §38.10, §24.5.1
 *
 * Invariants:
 *   1. request.payload forwarded but never stored or logged
 *   2. Transport layer must not modify/inspect/branch on payload content
 *   3. Timeout → NVG_ENDPOINT_TIMEOUT — never silent retry
 *   4. Network failure → NVG_ENDPOINT_UNREACHABLE
 *   5. Transport layer must not cache or replay responses
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DENIAL_CODE } from '../../packages/contracts/src/constants/index.js';
import type { ModelEndpoint, NvgOutboundRequest, NvgTransportContext } from '@nexus/contracts';
import { ModelTransportAdapterRegistry } from '../../packages/vanguard/src/transport/registry.js';
import { OllamaChatV1Adapter } from '../../packages/vanguard/src/transport/adapters/ollama-chat-v1.js';
import { callEndpoint } from '../../packages/vanguard/src/router/model-router.js';

function makeEndpoint(overrides?: Partial<ModelEndpoint>): ModelEndpoint {
  return {
    endpointId: 'inv-ep' as ModelEndpoint['endpointId'],
    tier: 'on_prem_general' as ModelEndpoint['tier'],
    url: 'http://localhost:11434/api/chat' as ModelEndpoint['url'],
    adapterId: 'ollama-chat-v1' as ModelEndpoint['adapterId'],
    modelName: 'llama3.2' as ModelEndpoint['modelName'],
    auth: { kind: 'none' as const },
    healthy: true,
    lastCheckAt: new Date().toISOString() as ModelEndpoint['lastCheckAt'],
    ...overrides,
  };
}

function makeRequest(): NvgOutboundRequest {
  return {
    requestId: '00000000-0000-0000-0000-000000000001' as NvgOutboundRequest['requestId'],
    runId: '00000000-0000-0000-0000-000000000002' as NvgOutboundRequest['runId'],
    actorId: '00000000-0000-0000-0000-000000000003' as NvgOutboundRequest['actorId'],
    octLevel: 'OCT-OPEN' as NvgOutboundRequest['octLevel'],
    environmentContext: 'development' as NvgOutboundRequest['environmentContext'],
    taskIntent: 'test' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'invariant test payload' }],
    dataLabels: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
  };
}

function makeContext(): NvgTransportContext {
  const registry = new ModelTransportAdapterRegistry();
  registry.register(new OllamaChatV1Adapter());
  return {
    registry,
    secretSource: { canResolve: async () => true, resolve: async () => 'stub' },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Transport Five Invariants (§24.5.1)', () => {
  it('invariant 1+2: payload forwarded verbatim in fetch body', async () => {
    const body = {
      model: 'llama3.2',
      message: { role: 'assistant', content: 'ok' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    );
    const req = makeRequest();
    const result = await callEndpoint(makeEndpoint(), req, makeContext());
    expect(result.success).toBe(true);
    const posted = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(posted.messages).toEqual(req.payload);
    expect(posted.model).toBe('llama3.2');
    expect(posted.stream).toBe(false);
  });

  it('invariant 3: timeout maps to NVG_ENDPOINT_TIMEOUT, never silent retry', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await callEndpoint(makeEndpoint(), makeRequest(), makeContext());
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('invariant 4: network failure maps to NVG_ENDPOINT_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const result = await callEndpoint(makeEndpoint(), makeRequest(), makeContext());
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE);
  });

  it('invariant 5: no caching — same call twice, fetch called twice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"model":"x"}', { status: 200 }))
    );
    const ctx = makeContext();
    await callEndpoint(makeEndpoint(), makeRequest(), ctx);
    await callEndpoint(makeEndpoint(), makeRequest(), ctx);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('UNKNOWN_ADAPTER when adapterId not registered', async () => {
    const ep = makeEndpoint({
      adapterId: 'nonexistent-v1' as ModelEndpoint['adapterId'],
    });
    const result = await callEndpoint(ep, makeRequest(), makeContext());
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_UNKNOWN_ADAPTER);
  });

  it('T6-F03: callEndpoint with fixture transport returns success', async () => {
    // T6-F03: stub-success path removed. Use explicit fixture adapter.
    const fixtureCtx: NvgTransportContext = {
      registry: {
        register() {},
        get() {
          return {
            adapterId: 'fixture' as any,
            adapterVersion: 'v0' as any,
            configSchema: { parse: (v: unknown) => v } as any,
            async invoke() {
              return { success: true, responseSize: 0, latencyMs: 1 };
            },
          };
        },
        list() {
          return [];
        },
      },
      secretSource: {
        async canResolve() {
          return true;
        },
        async resolve() {
          return 'x';
        },
      },
    };
    const result = await callEndpoint(makeEndpoint(), makeRequest(), fixtureCtx);
    expect(result.success).toBe(true);
  });
});
