/**
 * OpenAI Chat v1 Adapter Unit Tests — spec §38.9
 *
 * File: packages/vanguard/src/transport/adapters/openai-chat-v1.test.ts
 *
 * Same NINE scenarios as Ollama + OpenAI-specific body/header assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type NvgOutboundRequest,
  type SecretSource,
} from '@nexus/contracts';
import { OpenAiChatV1Adapter, OpenAiAdapterConfigSchema } from './openai-chat-v1.js';

function makeEndpoint(overrides?: Partial<ModelEndpoint>): ModelEndpoint {
  return {
    endpointId: 'test-openai' as ModelEndpoint['endpointId'],
    tier: 'frontier_general' as ModelEndpoint['tier'],
    url: 'https://api.openai.com/v1/chat/completions' as ModelEndpoint['url'],
    adapterId: 'openai-chat-v1' as ModelEndpoint['adapterId'],
    modelName: 'gpt-4o' as ModelEndpoint['modelName'],
    auth: {
      kind: 'bearer' as const,
      secretRef: 'OPENAI_KEY' as ModelEndpoint['endpointId'],
      headerName: 'Authorization' as ModelEndpoint['endpointId'],
      prefix: 'Bearer ' as ModelEndpoint['endpointId'],
    },
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
    taskIntent: 'test query' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'hello' }],
    dataLabels: [],
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

let adapter: OpenAiChatV1Adapter;

beforeEach(() => {
  adapter = new OpenAiChatV1Adapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OpenAiChatV1Adapter — §38.9', () => {
  // ─── Nine scenarios ───

  it('invoke success: returns success true with opaque response', async () => {
    const responseBody = {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [{ message: { content: 'hi' } }],
    };
    mockFetchResponse(200, responseBody);
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.success).toBe(true);
    expect(result.opaqueProviderResponse).toEqual(responseBody);
    expect(result.responseSize).toBe(
      new TextEncoder().encode(JSON.stringify(responseBody)).byteLength
    );
  });

  it('invoke 401: returns nvg_transport_auth_failed', async () => {
    mockFetchResponse(401, { error: {} });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED);
  });

  it('invoke 429: returns nvg_transport_rate_limited', async () => {
    mockFetchResponse(429, { error: {} });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED);
  });

  it('invoke 500: returns nvg_transport_provider_error', async () => {
    mockFetchResponse(500, { error: {} });
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR);
  });

  it('invoke timeout (fetch level): returns nvg_endpoint_timeout', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockFetchThrow(abortErr);
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
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
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
  });

  it('invoke unreachable: returns nvg_endpoint_unreachable', async () => {
    mockFetchThrow(new TypeError('fetch failed'));
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE);
  });

  it('invoke malformed JSON: returns nvg_transport_parse_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_PARSE_ERROR);
    expect(result.responseSize).toBeGreaterThan(0);
  });

  it('invoke with secretSource.resolve returning null: returns nvg_transport_auth_missing', async () => {
    const result = await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING);
  });

  it('invoke with secretSource.resolve throwing: returns nvg_transport_secret_source_error', async () => {
    const result = await adapter.invoke(
      makeEndpoint(),
      makeRequest(),
      makeSecretSource(null, true)
    );
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_SECRET_SOURCE_ERROR);
  });

  // ─── OpenAI-specific ───

  it('auth header is Authorization with prefix Bearer', async () => {
    mockFetchResponse(200, { model: 'gpt-4o' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('adapterConfig fields flow into request body when set', async () => {
    mockFetchResponse(200, { model: 'gpt-4o' });
    const ep = makeEndpoint({
      adapterConfig: {
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        stop: ['\n'],
      },
    });
    await adapter.invoke(ep, makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.temperature).toBe(0.7);
    expect(postedBody.max_tokens).toBe(2048);
    expect(postedBody.top_p).toBe(0.9);
    expect(postedBody.frequency_penalty).toBe(0.5);
    expect(postedBody.presence_penalty).toBe(0.3);
    expect(postedBody.stop).toEqual(['\n']);
  });

  it('adapterConfig fields absent when not set', async () => {
    mockFetchResponse(200, { model: 'gpt-4o' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody).not.toHaveProperty('temperature');
    expect(postedBody).not.toHaveProperty('max_tokens');
    expect(postedBody).not.toHaveProperty('top_p');
    expect(postedBody).not.toHaveProperty('frequency_penalty');
    expect(postedBody).not.toHaveProperty('presence_penalty');
    expect(postedBody).not.toHaveProperty('stop');
  });

  it('body construction explicit: model/messages/stream not operator-overridable', async () => {
    mockFetchResponse(200, { model: 'gpt-4o' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.model).toBe('gpt-4o');
    expect(postedBody.stream).toBe(false);
    expect(postedBody.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('invoke timer cleanup: clearTimeout runs in finally', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetchResponse(200, { model: 'gpt-4o' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('configSchema rejects unknown fields', () => {
    const result = OpenAiAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });
});
