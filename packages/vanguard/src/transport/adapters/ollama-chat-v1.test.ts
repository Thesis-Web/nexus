/**
 * Ollama Chat v1 Adapter Unit Tests — spec §38.9
 *
 * File: packages/vanguard/src/transport/adapters/ollama-chat-v1.test.ts
 *
 * Tests the full invoke() path:
 *   auth resolution → body construction → fetch → status mapping →
 *   body read → parse → opaque response
 *
 * Mocks globalThis.fetch per scenario. No network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type NvgOutboundRequest,
  type SecretSource,
} from '@nexus/contracts';
import { OllamaChatV1Adapter, OllamaAdapterConfigSchema } from './ollama-chat-v1.js';

// ─── Test helpers ───

function makeEndpoint(overrides?: Partial<ModelEndpoint>): ModelEndpoint {
  return {
    endpointId: 'test-ollama' as ModelEndpoint['endpointId'],
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

function makeAuthEndpoint(): ModelEndpoint {
  return makeEndpoint({
    auth: {
      kind: 'api_key' as const,
      secretRef: 'OLLAMA_KEY' as ModelEndpoint['endpointId'],
      headerName: 'Authorization' as ModelEndpoint['endpointId'],
    },
  });
}

function makeRequest(): NvgOutboundRequest {
  return {
    requestId: '00000000-0000-0000-0000-000000000001' as NvgOutboundRequest['requestId'],
    runId: '00000000-0000-0000-0000-000000000002' as NvgOutboundRequest['runId'],
    actorId: '00000000-0000-0000-0000-000000000003' as NvgOutboundRequest['actorId'],
    octLevel: 'OCT-OPEN' as NvgOutboundRequest['octLevel'],
    environmentContext: 'development' as NvgOutboundRequest['environmentContext'],
    taskIntent: 'test query' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'hello' }],
    dataLabels: [],
    boundConnectorClasses: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
  };
}

function makeSecretSource(result: string | null, shouldThrow = false): SecretSource {
  return {
    canResolve: async () => result !== null,
    resolve: async () => {
      if (shouldThrow) throw new Error('secret backend failure');
      return result;
    },
  };
}

function mockFetchResponse(status: number, body: unknown): void {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bodyStr, { status })));
}

function mockFetchThrow(err: Error): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
}

let adapter: OllamaChatV1Adapter;

beforeEach(() => {
  adapter = new OllamaChatV1Adapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Tests ───

describe('OllamaChatV1Adapter — §38.9', () => {
  it('invoke success: returns success true, opaqueProviderResponse populated, responseSize is byte count', async () => {
    const responseBody = { model: 'llama3.2', message: { role: 'assistant', content: 'hi' } };
    mockFetchResponse(200, responseBody);
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(true);
    expect(result.opaqueProviderResponse).toEqual(responseBody);
    const expectedBytes = new TextEncoder().encode(JSON.stringify(responseBody)).byteLength;
    expect(result.responseSize).toBe(expectedBytes);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('invoke 401: returns nvg_transport_auth_failed', async () => {
    mockFetchResponse(401, { error: 'unauthorized' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED);
  });

  it('invoke 403: returns nvg_transport_auth_failed', async () => {
    mockFetchResponse(403, { error: 'forbidden' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED);
  });

  it('invoke 429: returns nvg_transport_rate_limited', async () => {
    mockFetchResponse(429, { error: 'rate limited' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED);
  });

  it('invoke 500: returns nvg_transport_provider_error', async () => {
    mockFetchResponse(500, { error: 'internal' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR);
  });

  it('invoke timeout (fetch level): returns nvg_endpoint_timeout', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockFetchThrow(abortErr);
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
  });

  it('invoke timeout (body-stall): returns nvg_endpoint_timeout', async () => {
    const abortErr = new Error('body stall');
    abortErr.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        arrayBuffer: vi.fn().mockRejectedValue(abortErr),
      })
    );
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
  });

  it('invoke unreachable: returns nvg_endpoint_unreachable', async () => {
    mockFetchThrow(new TypeError('fetch failed'));
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE);
  });

  it('invoke malformed JSON: returns nvg_transport_parse_error with responseSize set', async () => {
    const badBody = 'not json at all';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(badBody, { status: 200 })));
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_PARSE_ERROR);
    expect(result.responseSize).toBe(new TextEncoder().encode(badBody).byteLength);
  });

  it('invoke with secretSource.resolve returning null: returns nvg_transport_auth_missing', async () => {
    const result = await adapter.invoke(makeAuthEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING);
  });

  it('invoke with secretSource.resolve throwing: returns nvg_transport_secret_source_error', async () => {
    const result = await adapter.invoke(
      makeAuthEndpoint(),
      makeRequest(),
      makeSecretSource(null, true)
    );
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_SECRET_SOURCE_ERROR);
  });

  it('invoke body construction: stream === false ALWAYS', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody.stream).toBe(false);
  });

  it('invoke body construction: model === endpoint.modelName ALWAYS', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    await adapter.invoke(
      makeEndpoint({ modelName: 'custom-model' as ModelEndpoint['modelName'] }),
      makeRequest(),
      makeSecretSource(null)
    );
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody.model).toBe('custom-model');
  });

  it('invoke body construction: messages === request.payload ALWAYS', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    const req = makeRequest();
    await adapter.invoke(makeEndpoint(), req, makeSecretSource(null));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody.messages).toEqual(req.payload);
  });

  it('invoke body construction: num_predict inside adapterConfig.options flows into body.options', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    const ep = makeEndpoint({
      adapterConfig: { options: { num_predict: 2048 } },
    });
    await adapter.invoke(ep, makeRequest(), makeSecretSource(null));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody.options).toEqual({ num_predict: 2048 });
  });

  it('invoke body construction: optional fields absent when not in adapterConfig', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody).not.toHaveProperty('options');
    expect(postedBody).not.toHaveProperty('keep_alive');
  });

  it('invoke body construction: keep_alive flows when set', async () => {
    mockFetchResponse(200, { model: 'llama3.2' });
    const ep = makeEndpoint({ adapterConfig: { keep_alive: '5m' } });
    await adapter.invoke(ep, makeRequest(), makeSecretSource(null));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const postedBody = JSON.parse(fetchCall[1]!.body as string);
    expect(postedBody.keep_alive).toBe('5m');
  });

  it('invoke timer cleanup: clearTimeout runs in finally', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetchResponse(200, { model: 'llama3.2' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('invoke timer cleanup: clearTimeout runs on denial path too', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetchResponse(500, { error: 'fail' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('configSchema rejects unknown field stream', () => {
    const result = OllamaAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });

  it('configSchema rejects num_predict at top level (audit C-C)', () => {
    const result = OllamaAdapterConfigSchema.safeParse({ num_predict: 2048 });
    expect(result.success).toBe(false);
  });

  it('configSchema accepts options.num_predict (audit C-C)', () => {
    const result = OllamaAdapterConfigSchema.safeParse({
      options: { num_predict: 2048 },
    });
    expect(result.success).toBe(true);
  });

  it('providerModelNameReturned extracted from response when present', async () => {
    mockFetchResponse(200, { model: 'llama3.2:latest' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(true);
    expect(result.providerModelNameReturned).toBe('llama3.2:latest');
  });

  it('providerModelNameReturned absent when response has no model field', async () => {
    mockFetchResponse(200, { text: 'hello' });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.success).toBe(true);
    expect(result.providerModelNameReturned).toBeUndefined();
  });
});
