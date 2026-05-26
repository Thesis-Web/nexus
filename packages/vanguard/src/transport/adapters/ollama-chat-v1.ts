/**
 * Ollama Chat v1 Transport Adapter — spec §24.5.4
 *
 * File: packages/vanguard/src/transport/adapters/ollama-chat-v1.ts
 * Layer 3 — imports from @nexus/contracts + zod (approved external lib).
 *
 * Reference adapter for Ollama POST /api/chat.
 * Wire-format family: 'ollama-chat-v1'.
 *
 * Governed invariants (§24.5.1):
 *   1. request.payload forwarded but never stored or logged
 *   2. Transport layer must not modify/inspect/branch on payload content
 *   3. Timeout → NVG_ENDPOINT_TIMEOUT — never silent retry
 *   4. Network failure → NVG_ENDPOINT_UNREACHABLE
 *   5. Transport layer must not cache or replay responses
 *
 * Body construction: EXPLICIT, no ...adapterConfig spread (audit B1).
 * Timeout law (audit B5): single try/finally covers fetch + body read.
 * num_predict: inside options.num_predict per Ollama wire format (audit C-C).
 */
import { z } from 'zod';
import { getDefaultTimeoutMsForTier } from '../../router/tier-timeout.js';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type ModelTransportAdapter,
  type NvgOutboundRequest,
  type SecretSource,
  type NonEmpty,
  type ToolSchemaDescriptor,
} from '@nexus/contracts';
import { toOllamaTools } from '../tool-schema-translators.js';

// Phase 8 — TIMEOUT_DEFAULT_MS is retained for backward-compat callers
// that may import it. New code path uses getDefaultTimeoutMsForTier
// which gives on-prem endpoints a more realistic 120s default.
const TIMEOUT_DEFAULT_MS = 30_000;

// Per-adapter config schema (§12.3.40 configSchema; audit B1).
// Validated at MANIFEST LOAD time by the endpoint manifest loader (§26.5 Step 6.5).
// .strict() rejects unknown fields. Forbidden keys (stream, model, etc.) rejected by
// the loader earlier in §26.5 Step 6.4 BEFORE this schema is invoked.
//
// r4 (audit C-C): num_predict is NOT a top-level field — Ollama API places it inside
// options.num_predict. Operators set it via adapterConfig.options = { num_predict: <int>, ... }.
export const OllamaAdapterConfigSchema = z
  .object({
    options: z.record(z.unknown()).optional(), // Ollama options bag (num_predict, temperature, etc.)
    keep_alive: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

export type OllamaAdapterConfig = z.infer<typeof OllamaAdapterConfigSchema>;

/**
 * CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §4 — accept either a bare
 * messages array (legacy) or `{ messages, tools?, toolDescriptors? }`.
 * Same shape as the OpenAI adapter; see that file for the rationale.
 *
 * `toolDescriptors` is the canonical neutral shape the orchestrator
 * attaches; this adapter translates them into the provider format
 * via toOllamaTools(). `tools` is the legacy escape hatch for tests
 * and direct-shape callers — when both are present, toolDescriptors
 * wins (it's the governance-bound surface).
 */
const PayloadSchema = z.union([
  z.array(z.unknown()),
  z
    .object({
      messages: z.array(z.unknown()),
      tools: z.array(z.unknown()).optional(),
      toolDescriptors: z.array(z.unknown()).optional(),
    })
    .strict(),
]);

export class OllamaChatV1Adapter implements ModelTransportAdapter<OllamaAdapterConfig> {
  readonly adapterId = 'ollama-chat-v1';
  readonly adapterVersion = '1.0.0';
  readonly configSchema = OllamaAdapterConfigSchema;

  async invoke(
    endpoint: ModelEndpoint,
    request: NvgOutboundRequest,
    secretSource: SecretSource
  ): Promise<ModelEndpointResponse> {
    const startMs = Date.now();
    const timeoutMs = endpoint.timeoutMs ?? getDefaultTimeoutMsForTier(endpoint.tier);

    // 1. Auth resolution
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (endpoint.auth.kind !== 'none') {
      let secret: string | null;
      try {
        secret = await secretSource.resolve(endpoint.auth.secretRef);
      } catch (err: unknown) {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_SECRET_SOURCE_ERROR,
          reason: err instanceof Error ? err.message : 'secret source threw',
          latencyMs: Date.now() - startMs,
        };
      }
      if (secret === null) {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING,
          reason: `secret ${endpoint.auth.secretRef} not resolvable`,
          latencyMs: Date.now() - startMs,
        };
      }
      headers[endpoint.auth.headerName] = (endpoint.auth.prefix ?? '') + secret;
    }

    // 2. EXPLICIT body construction (audit B1). adapterConfig has been schema-validated
    //    at manifest load by the loader (§26.5 Step 6.5). Forbidden keys were already
    //    rejected at Step 6.4. We pull individual validated fields by name — NEVER spread.
    //
    //    r4 (audit C-C): num_predict lives inside options.num_predict per Ollama API.
    //
    //    Phase C: payload may be either a bare messages array (legacy)
    //    or { messages, tools? }. Validate at the boundary — a bad shape
    //    returns a denial without raising.
    const payloadParse = PayloadSchema.safeParse(request.payload);
    if (!payloadParse.success) {
      return {
        success: false,
        denialCode: DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR,
        reason: 'invalid payload shape — expected messages array or {messages, tools?}',
        latencyMs: Date.now() - startMs,
      };
    }
    const messages = Array.isArray(payloadParse.data)
      ? payloadParse.data
      : payloadParse.data.messages;
    const explicitTools = Array.isArray(payloadParse.data) ? undefined : payloadParse.data.tools;
    const toolDescriptors = Array.isArray(payloadParse.data)
      ? undefined
      : payloadParse.data.toolDescriptors;

    // Translate neutral descriptors → Ollama tool format. When both
    // toolDescriptors and a legacy tools array are present, descriptors
    // win — they're the governance-bound surface fed by the
    // composition root via the connector's describeToolSchemas().
    let tools: unknown[] | undefined;
    if (toolDescriptors !== undefined && toolDescriptors.length > 0) {
      tools = toOllamaTools(toolDescriptors as readonly ToolSchemaDescriptor[]);
    } else if (explicitTools !== undefined && explicitTools.length > 0) {
      tools = explicitTools;
    }

    const cfg = (endpoint.adapterConfig ?? {}) as OllamaAdapterConfig;
    const body: Record<string, unknown> = {
      model: endpoint.modelName, // from endpoint (NOT operator-overridable)
      messages, // from request (NOT operator-overridable)
      stream: false, // NISP-001.A streaming forbidden — HARDCODED
    };
    if (tools !== undefined && tools.length > 0) body.tools = tools;
    if (cfg.options !== undefined) body.options = cfg.options;
    if (cfg.keep_alive !== undefined) body.keep_alive = cfg.keep_alive;

    // 3. HTTP dispatch via globalThis.fetch — r4 (audit B5): timeout MUST cover BOTH
    //    fetch resolution AND response body consumption. Single try/finally around BOTH.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;
      try {
        response = await globalThis.fetch(endpoint.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        return {
          success: false,
          denialCode: isTimeout
            ? DENIAL_CODE.NVG_ENDPOINT_TIMEOUT
            : DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
          reason: err instanceof Error ? err.message : 'network failure',
          latencyMs: Date.now() - startMs,
        };
      }

      // 4. Status → denial code (§12.2 mapping table)
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED,
          reason: `provider ${response.status}`,
          latencyMs: Date.now() - startMs,
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED,
          reason: 'provider rate limit',
          latencyMs: Date.now() - startMs,
        };
      }
      if (response.status >= 500 || !response.ok) {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR,
          reason: `provider ${response.status}`,
          latencyMs: Date.now() - startMs,
        };
      }

      // 5. Body read + size measurement (BYTE COUNT per audit C1).
      //    r4 (audit B5): arrayBuffer() can throw AbortError if body stalls.
      let responseBuffer: ArrayBuffer;
      try {
        responseBuffer = await response.arrayBuffer();
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        return {
          success: false,
          denialCode: isTimeout
            ? DENIAL_CODE.NVG_ENDPOINT_TIMEOUT
            : DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
          reason: err instanceof Error ? err.message : 'body read failure',
          latencyMs: Date.now() - startMs,
        };
      }
      const responseSize = responseBuffer.byteLength;

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(responseBuffer));
      } catch {
        return {
          success: false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_PARSE_ERROR,
          reason: 'response body not valid JSON',
          latencyMs: Date.now() - startMs,
          responseSize,
        };
      }

      // 6. Provider-returned model identifier (best-effort extraction)
      const providerModelNameReturned: string | undefined =
        typeof parsed === 'object' &&
        parsed !== null &&
        'model' in parsed &&
        typeof (parsed as { model: unknown }).model === 'string' &&
        (parsed as { model: string }).model.length > 0
          ? (parsed as { model: string }).model
          : undefined;

      // exactOptionalPropertyTypes: build result, then conditionally set
      // optional fields that may be absent. This is the TypeScript-correct
      // pattern — optional properties must not be assigned undefined.
      const successResult: ModelEndpointResponse = {
        success: true,
        responseSize,
        latencyMs: Date.now() - startMs,
        opaqueProviderResponse: parsed, // OPAQUE — never inspected downstream by NVG
      };
      if (providerModelNameReturned !== undefined) {
        successResult.providerModelNameReturned = providerModelNameReturned as NonEmpty;
      }
      return successResult;
    } finally {
      // r4 (audit B5): clear timer ONLY here, after fetch + body read have either
      // completed OR returned a denial response.
      clearTimeout(timer);
    }
  }
}
