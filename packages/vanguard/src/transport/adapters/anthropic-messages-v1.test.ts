/**
 * Anthropic Messages v1 Adapter Unit Tests — spec §38.9
 *
 * File: packages/vanguard/src/transport/adapters/anthropic-messages-v1.test.ts
 *
 * Same NINE scenarios as Ollama + Anthropic-specific body/header assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type NvgOutboundRequest,
  type SecretSource,
} from '@nexus/contracts';
import {
  AnthropicMessagesV1Adapter,
  AnthropicAdapterConfigSchema,
} from './anthropic-messages-v1.js';

function makeEndpoint(overrides?: Partial<ModelEndpoint>): ModelEndpoint {
  return {
    endpointId: 'test-anthropic' as ModelEndpoint['endpointId'],
    tier: 'frontier_general' as ModelEndpoint['tier'],
    url: 'https://api.anthropic.com/v1/messages' as ModelEndpoint['url'],
    adapterId: 'anthropic-messages-v1' as ModelEndpoint['adapterId'],
    modelName: 'claude-sonnet-4-20250514' as ModelEndpoint['modelName'],
    auth: {
      kind: 'api_key' as const,
      secretRef: 'ANTHROPIC_KEY' as ModelEndpoint['endpointId'],
      headerName: 'x-api-key' as ModelEndpoint['endpointId'],
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
    boundConnectorClasses: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
    carriedClaims: {},
    provenance: 'workspace_upload',
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

let adapter: AnthropicMessagesV1Adapter;

beforeEach(() => {
  adapter = new AnthropicMessagesV1Adapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AnthropicMessagesV1Adapter — §38.9', () => {
  // ─── Nine scenarios ───

  it('invoke success: returns success true with opaque response', async () => {
    const responseBody = {
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      content: [{ text: 'hi' }],
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

  // ─── Anthropic-specific ───

  it('request body always includes max_tokens (default 4096 when adapterConfig absent)', async () => {
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.max_tokens).toBe(4096);
  });

  it('request body uses adapterConfig.max_tokens when provided', async () => {
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    const ep = makeEndpoint({ adapterConfig: { max_tokens: 1024 } });
    await adapter.invoke(ep, makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.max_tokens).toBe(1024);
  });

  it('required header anthropic-version: 2023-06-01 present', async () => {
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = fetchCall[1]!.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('auth header is x-api-key (no prefix)', async () => {
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = fetchCall[1]!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
  });

  it('body construction explicit: model/messages/stream not operator-overridable', async () => {
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.model).toBe('claude-sonnet-4-20250514');
    expect(postedBody.stream).toBe(false);
    expect(postedBody.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('invoke timer cleanup: clearTimeout runs in finally', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetchResponse(200, { model: 'claude-sonnet-4-20250514' });
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource('sk-test'));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('configSchema rejects unknown fields', () => {
    const result = AnthropicAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });
});
