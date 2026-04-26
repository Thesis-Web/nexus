/**
 * Transport Runtime Wire-Through Conformance Test — spec §38.10, Step 18
 *
 * callEndpoint → registry.get(adapterId) → adapter.invoke → mocked fetch → response
 * For each registered adapter: success + denial path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DENIAL_CODE } from '../../packages/contracts/src/constants/index.js';
import type { ModelEndpoint, NvgOutboundRequest, NvgTransportContext } from '@nexus/contracts';
import { ModelTransportAdapterRegistry } from '../../packages/vanguard/src/transport/registry.js';
import { OllamaChatV1Adapter } from '../../packages/vanguard/src/transport/adapters/ollama-chat-v1.js';
import { AnthropicMessagesV1Adapter } from '../../packages/vanguard/src/transport/adapters/anthropic-messages-v1.js';
import { OpenAiChatV1Adapter } from '../../packages/vanguard/src/transport/adapters/openai-chat-v1.js';
import { callEndpoint } from '../../packages/vanguard/src/router/model-router.js';

function makeRequest(): NvgOutboundRequest {
  return {
    requestId: '00000000-0000-0000-0000-000000000001' as NvgOutboundRequest['requestId'],
    runId: '00000000-0000-0000-0000-000000000002' as NvgOutboundRequest['runId'],
    actorId: '00000000-0000-0000-0000-000000000003' as NvgOutboundRequest['actorId'],
    octLevel: 'OCT-OPEN' as NvgOutboundRequest['octLevel'],
    environmentContext: 'development' as NvgOutboundRequest['environmentContext'],
    taskIntent: 'wire-through test' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'hello' }],
    dataLabels: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
  };
}

function makeEndpoint(adapterId: string, auth?: ModelEndpoint['auth']): ModelEndpoint {
  return {
    endpointId: `ep-${adapterId}` as ModelEndpoint['endpointId'],
    tier: 'on_prem_general' as ModelEndpoint['tier'],
    url: 'http://localhost:11434/api/chat' as ModelEndpoint['url'],
    adapterId: adapterId as ModelEndpoint['adapterId'],
    modelName: 'test-model' as ModelEndpoint['modelName'],
    auth: auth ?? { kind: 'none' as const },
    healthy: true,
    lastCheckAt: new Date().toISOString() as ModelEndpoint['lastCheckAt'],
  };
}

function makeContext(): NvgTransportContext {
  const registry = new ModelTransportAdapterRegistry();
  registry.register(new OllamaChatV1Adapter());
  registry.register(new AnthropicMessagesV1Adapter());
  registry.register(new OpenAiChatV1Adapter());
  return {
    registry,
    secretSource: {
      canResolve: async () => true,
      resolve: async () => 'test-api-key',
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Transport Runtime Wire-Through (Step 18)', () => {
  describe('Ollama', () => {
    it('success path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"model":"test-model"}', { status: 200 }))
      );
      const result = await callEndpoint(
        makeEndpoint('ollama-chat-v1'),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(true);
      expect(result.opaqueProviderResponse).toEqual({ model: 'test-model' });
    });
    it('denial path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"error":"fail"}', { status: 500 }))
      );
      const result = await callEndpoint(
        makeEndpoint('ollama-chat-v1'),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(false);
      expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR);
    });
  });

  describe('Anthropic', () => {
    const auth: ModelEndpoint['auth'] = {
      kind: 'api_key' as const,
      secretRef: 'KEY' as ModelEndpoint['endpointId'],
      headerName: 'x-api-key' as ModelEndpoint['endpointId'],
    };
    it('success path with auth header', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"id":"msg_01","model":"m"}', { status: 200 }))
      );
      const result = await callEndpoint(
        makeEndpoint('anthropic-messages-v1', auth),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(true);
      const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<
        string,
        string
      >;
      expect(headers['x-api-key']).toBe('test-api-key');
    });
    it('denial path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"error":"rate"}', { status: 429 }))
      );
      const result = await callEndpoint(
        makeEndpoint('anthropic-messages-v1', auth),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(false);
      expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED);
    });
  });

  describe('OpenAI', () => {
    const auth: ModelEndpoint['auth'] = {
      kind: 'bearer' as const,
      secretRef: 'KEY' as ModelEndpoint['endpointId'],
      headerName: 'Authorization' as ModelEndpoint['endpointId'],
      prefix: 'Bearer ' as ModelEndpoint['endpointId'],
    };
    it('success path with Bearer prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"id":"c-1","model":"m"}', { status: 200 }))
      );
      const result = await callEndpoint(
        makeEndpoint('openai-chat-v1', auth),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(true);
      const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<
        string,
        string
      >;
      expect(headers['Authorization']).toBe('Bearer test-api-key');
    });
    it('denial path', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"error":"bad"}', { status: 401 }))
      );
      const result = await callEndpoint(
        makeEndpoint('openai-chat-v1', auth),
        makeRequest(),
        makeContext()
      );
      expect(result.success).toBe(false);
      expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED);
    });
  });
});
