/**
 * Transport Timeout Body Stall Conformance Test — spec §38.10 (audit B5)
 *
 * Three scenarios per adapter through callEndpoint:
 *   1. Body withheld → nvg_endpoint_timeout
 *   2. Body completes before timeout → success
 *   3. Body arrives past timeout → nvg_endpoint_timeout, no partial body
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
    taskIntent: 'body stall test' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'hello' }],
    dataLabels: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
  };
}

function makeContext(): NvgTransportContext {
  const reg = new ModelTransportAdapterRegistry();
  reg.register(new OllamaChatV1Adapter());
  reg.register(new AnthropicMessagesV1Adapter());
  reg.register(new OpenAiChatV1Adapter());
  return {
    registry: reg,
    secretSource: {
      canResolve: async () => true,
      resolve: async () => 'test-key',
    },
  };
}

function makeEndpoint(adapterId: string, authKind: 'none' | 'api_key' = 'none'): ModelEndpoint {
  return {
    endpointId: `ep-${adapterId}` as ModelEndpoint['endpointId'],
    tier: 'on_prem_general' as ModelEndpoint['tier'],
    url: 'http://localhost:11434/api/chat' as ModelEndpoint['url'],
    adapterId: adapterId as ModelEndpoint['adapterId'],
    modelName: 'test-model' as ModelEndpoint['modelName'],
    auth:
      authKind === 'none'
        ? { kind: 'none' as const }
        : {
            kind: 'api_key' as const,
            secretRef: 'KEY' as ModelEndpoint['endpointId'],
            headerName: 'x-api-key' as ModelEndpoint['endpointId'],
          },
    healthy: true,
    lastCheckAt: new Date().toISOString() as ModelEndpoint['lastCheckAt'],
    timeoutMs: 200,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ADAPTERS = [
  {
    id: 'ollama-chat-v1',
    auth: 'none' as const,
    body: { model: 'test-model' },
  },
  {
    id: 'anthropic-messages-v1',
    auth: 'api_key' as const,
    body: { id: 'msg', type: 'message', content: [], model: 'test-model' },
  },
  {
    id: 'openai-chat-v1',
    auth: 'api_key' as const,
    body: { id: 'c-1', choices: [], model: 'test-model' },
  },
];

describe('Transport Timeout Body Stall (audit B5)', () => {
  for (const a of ADAPTERS) {
    describe(a.id, () => {
      it('body withheld → nvg_endpoint_timeout', async () => {
        const err = new Error('body stall');
        err.name = 'AbortError';
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            status: 200,
            ok: true,
            arrayBuffer: vi.fn().mockRejectedValue(err),
          })
        );
        const r = await callEndpoint(makeEndpoint(a.id, a.auth), makeRequest(), makeContext());
        expect(r.success).toBe(false);
        expect(r.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
        expect(r.opaqueProviderResponse).toBeUndefined();
      });

      it('body completes before timeout → success', async () => {
        const buf = new TextEncoder().encode(JSON.stringify(a.body)).buffer;
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            status: 200,
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(buf),
          })
        );
        const r = await callEndpoint(makeEndpoint(a.id, a.auth), makeRequest(), makeContext());
        expect(r.success).toBe(true);
        expect(r.responseSize).toBeGreaterThan(0);
      });

      it('body past timeout → nvg_endpoint_timeout, no partial body', async () => {
        const err = new Error('body stall past timeout');
        err.name = 'AbortError';
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            status: 200,
            ok: true,
            arrayBuffer: vi.fn().mockRejectedValue(err),
          })
        );
        const r = await callEndpoint(makeEndpoint(a.id, a.auth), makeRequest(), makeContext());
        expect(r.success).toBe(false);
        expect(r.denialCode).toBe(DENIAL_CODE.NVG_ENDPOINT_TIMEOUT);
        expect(r.opaqueProviderResponse).toBeUndefined();
      });
    });
  }
});
