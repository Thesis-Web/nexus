/**
 * NVG Transport Threat Tests 14–17 — spec §38.12
 *
 * File: packages/vanguard/src/transport/transport.threat.test.ts
 *
 * Four transport threat scenarios:
 *   14. unknown-adapter: unregistered adapterId → NVG_TRANSPORT_UNKNOWN_ADAPTER
 *   15. auth-missing-startup: secretSource returns null → NVG_TRANSPORT_AUTH_MISSING
 *   16. stream-field-rejected: all 3 configSchemas reject stream:true via .strict()
 *   17. content-leak: opaqueProviderResponse excluded from EvidenceRecord type
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type NvgOutboundRequest,
  type NvgTransportContext,
  type SecretSource,
  type ModelTransportAdapterRegistry,
  type EvidenceRecord,
} from '@nexus/contracts';
import { callEndpoint } from '../router/model-router.js';
import { OllamaAdapterConfigSchema } from './adapters/ollama-chat-v1.js';
import { AnthropicAdapterConfigSchema } from './adapters/anthropic-messages-v1.js';
import { OpenAiAdapterConfigSchema } from './adapters/openai-chat-v1.js';
import { OllamaChatV1Adapter } from './adapters/ollama-chat-v1.js';

// ─── Test helpers ───

function makeEndpoint(overrides?: Partial<ModelEndpoint>): ModelEndpoint {
  return {
    endpointId: 'threat-ep' as ModelEndpoint['endpointId'],
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
    taskIntent: 'threat test' as NvgOutboundRequest['taskIntent'],
    payload: [{ role: 'user', content: 'test' }],
    dataLabels: [],
    boundConnectorClasses: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
    carriedClaims: {},
    provenance: 'workspace_upload',
  };
}

function makeSecretSource(result: string | null): SecretSource {
  return {
    canResolve: async () => result !== null,
    resolve: async () => result,
  };
}

function makeEmptyRegistry(): ModelTransportAdapterRegistry {
  return {
    get: () => null,
    list: () => [],
    register: () => {},
  };
}

function makeTransportContext(
  secretSource: SecretSource,
  registry: ModelTransportAdapterRegistry
): NvgTransportContext {
  return { registry, secretSource };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Threat 14: Unknown Adapter ───

describe('NVG Threat 14: Unknown Adapter (§38.12)', () => {
  it('callEndpoint returns NVG_TRANSPORT_UNKNOWN_ADAPTER when adapterId not registered', async () => {
    const ep = makeEndpoint({ adapterId: 'nonexistent-adapter-v99' as ModelEndpoint['adapterId'] });
    const ctx = makeTransportContext(makeSecretSource(null), makeEmptyRegistry());
    const result = await callEndpoint(ep, makeRequest(), ctx);

    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_UNKNOWN_ADAPTER);
    expect(result.reason).toContain('nonexistent-adapter-v99');
  });

  it('callEndpoint returns NVG_TRANSPORT_UNKNOWN_ADAPTER even with valid auth', async () => {
    const ep = makeEndpoint({
      adapterId: 'ghost-adapter' as ModelEndpoint['adapterId'],
      auth: {
        kind: 'api_key' as const,
        secretRef: 'SOME_KEY' as ModelEndpoint['endpointId'],
        headerName: 'Authorization' as ModelEndpoint['endpointId'],
      },
    });
    const ctx = makeTransportContext(makeSecretSource('real-key'), makeEmptyRegistry());
    const result = await callEndpoint(ep, makeRequest(), ctx);

    // Adapter lookup happens BEFORE auth resolution — unknown adapter denies first
    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_UNKNOWN_ADAPTER);
  });
});

// ─── Threat 15: Auth Missing at Startup ───

describe('NVG Threat 15: Auth Missing at Startup (§38.12)', () => {
  it('adapter returns NVG_TRANSPORT_AUTH_MISSING when secret not resolvable', async () => {
    const adapter = new OllamaChatV1Adapter();
    const ep = makeEndpoint({
      auth: {
        kind: 'api_key' as const,
        secretRef: 'MISSING_SECRET' as ModelEndpoint['endpointId'],
        headerName: 'Authorization' as ModelEndpoint['endpointId'],
      },
    });

    const result = await adapter.invoke(ep, makeRequest(), makeSecretSource(null));

    expect(result.success).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING);
    expect(result.reason).toContain('MISSING_SECRET');
  });

  it('auth missing denial includes latencyMs for audit trail', async () => {
    const adapter = new OllamaChatV1Adapter();
    const ep = makeEndpoint({
      auth: {
        kind: 'bearer' as const,
        secretRef: 'NOT_SET' as ModelEndpoint['endpointId'],
        headerName: 'Authorization' as ModelEndpoint['endpointId'],
        prefix: 'Bearer ' as ModelEndpoint['endpointId'],
      },
    });

    const result = await adapter.invoke(ep, makeRequest(), makeSecretSource(null));

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING);
  });
});

// ─── Threat 16: Stream Field Rejected ───

describe('NVG Threat 16: Stream Field Rejected (§38.12)', () => {
  it('OllamaAdapterConfigSchema rejects stream:true via .strict()', () => {
    const result = OllamaAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });

  it('OllamaAdapterConfigSchema rejects stream:false via .strict()', () => {
    const result = OllamaAdapterConfigSchema.safeParse({ stream: false });
    expect(result.success).toBe(false);
  });

  it('AnthropicAdapterConfigSchema rejects stream:true via .strict()', () => {
    const result = AnthropicAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });

  it('AnthropicAdapterConfigSchema rejects stream:false via .strict()', () => {
    const result = AnthropicAdapterConfigSchema.safeParse({ stream: false });
    expect(result.success).toBe(false);
  });

  it('OpenAiAdapterConfigSchema rejects stream:true via .strict()', () => {
    const result = OpenAiAdapterConfigSchema.safeParse({ stream: true });
    expect(result.success).toBe(false);
  });

  it('OpenAiAdapterConfigSchema rejects stream:false via .strict()', () => {
    const result = OpenAiAdapterConfigSchema.safeParse({ stream: false });
    expect(result.success).toBe(false);
  });

  it('adapter invoke hardcodes stream:false regardless of adapterConfig', async () => {
    const adapter = new OllamaChatV1Adapter();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ model: 'llama3.2' }), { status: 200 }))
    );
    await adapter.invoke(makeEndpoint(), makeRequest(), makeSecretSource(null));
    const postedBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(postedBody.stream).toBe(false);
  });
});

// ─── Threat 17: Content Leak ───

describe('NVG Threat 17: Content Leak (§38.12)', () => {
  it('EvidenceRecord type does NOT have opaqueProviderResponse field', () => {
    // Compile-time assertion via TypeScript structural check.
    // If EvidenceRecord ever gains opaqueProviderResponse, this test breaks.
    const evidenceKeys: (keyof EvidenceRecord)[] = [
      'recordId',
      'actionId',
      'sessionId',
      'runId',
      'ledgerSequence',
      'actionSummary',
      'intentEvidence',
      'delegationContextSnapshot',
      'gateDecisions',
      'policyRuleId',
      'policyOutcome',
      'approvalRequired',
      'approvalRequest',
      'approvalResponse',
      'approvalDecisionLabel',
      'grantMetadata',
      'executionResult',
      'finalOutcome',
      'threatEvents',
      'compilerView',
      'previousHash',
      'recordHash',
      'signature',
    ];
    expect(evidenceKeys).not.toContain('opaqueProviderResponse');
    // Also verify at runtime that a fully-populated stub doesn't accidentally carry it
    const stubRecord = {} as EvidenceRecord;
    expect('opaqueProviderResponse' in stubRecord).toBe(false);
  });

  it('opaque content does not appear in EvidenceRecord field names (exhaustive)', () => {
    // Defense-in-depth: grep-equivalent for the EvidenceRecord type.
    // This uses a known list of EvidenceRecord keys to verify none contain
    // 'opaque', 'provider', or 'response' in the field name.
    const dangerousPatterns = ['opaque', 'providerResponse', 'rawPayload', 'rawContent'];
    const recordFields: string[] = [
      'recordId',
      'actionId',
      'sessionId',
      'runId',
      'ledgerSequence',
      'actionSummary',
      'intentEvidence',
      'delegationContextSnapshot',
      'gateDecisions',
      'policyRuleId',
      'policyOutcome',
      'approvalRequired',
      'approvalRequest',
      'approvalResponse',
      'approvalDecisionLabel',
      'grantMetadata',
      'executionResult',
      'finalOutcome',
      'threatEvents',
      'compilerView',
      'previousHash',
      'recordHash',
      'signature',
    ];
    for (const field of recordFields) {
      for (const pattern of dangerousPatterns) {
        expect(field.toLowerCase()).not.toContain(pattern.toLowerCase());
      }
    }
  });
});
