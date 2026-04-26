/**
 * OpenAI Chat v1 Transport Adapter — spec §24.5.6
 *
 * File: packages/vanguard/src/transport/adapters/openai-chat-v1.ts
 * Layer 3 — imports from @nexus/contracts + zod (approved external lib).
 *
 * Wire-format family: 'openai-chat-v1'.
 * Target: OpenAI / OpenAI-compatible POST /v1/chat/completions
 *
 * Same five governed invariants as Ollama (§24.5.1).
 * Same timeout law (audit B5): single try/finally covers fetch + body read.
 * Body construction: EXPLICIT, no ...adapterConfig spread.
 */
import { z } from 'zod';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type ModelTransportAdapter,
  type NvgOutboundRequest,
  type SecretSource,
  type NonEmpty,
} from '@nexus/contracts';

const TIMEOUT_DEFAULT_MS = 30_000;

export const OpenAiAdapterConfigSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    top_p: z.number().min(0).max(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

export type OpenAiAdapterConfig = z.infer<typeof OpenAiAdapterConfigSchema>;

export class OpenAiChatV1Adapter implements ModelTransportAdapter<OpenAiAdapterConfig> {
  readonly adapterId = 'openai-chat-v1';
  readonly adapterVersion = '1.0.0';
  readonly configSchema = OpenAiAdapterConfigSchema;

  async invoke(
    endpoint: ModelEndpoint,
    request: NvgOutboundRequest,
    secretSource: SecretSource
  ): Promise<ModelEndpointResponse> {
    const startMs = Date.now();
    const timeoutMs = endpoint.timeoutMs ?? TIMEOUT_DEFAULT_MS;

    // 1. Auth resolution — OpenAI uses Authorization: Bearer <secret>
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

    // 2. EXPLICIT body construction
    const cfg = (endpoint.adapterConfig ?? {}) as OpenAiAdapterConfig;
    const body: Record<string, unknown> = {
      model: endpoint.modelName,
      messages: request.payload,
      stream: false,
    };
    if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
    if (cfg.max_tokens !== undefined) body.max_tokens = cfg.max_tokens;
    if (cfg.top_p !== undefined) body.top_p = cfg.top_p;
    if (cfg.frequency_penalty !== undefined) body.frequency_penalty = cfg.frequency_penalty;
    if (cfg.presence_penalty !== undefined) body.presence_penalty = cfg.presence_penalty;
    if (cfg.stop !== undefined) body.stop = cfg.stop;

    // 3. HTTP dispatch — single try/finally (audit B5)
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

      // 4. Status → denial code
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

      // 5. Body read + byte-count sizing (audit B5)
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

      // 6. Provider-returned model identifier
      const providerModelNameReturned: string | undefined =
        typeof parsed === 'object' &&
        parsed !== null &&
        'model' in parsed &&
        typeof (parsed as { model: unknown }).model === 'string' &&
        (parsed as { model: string }).model.length > 0
          ? (parsed as { model: string }).model
          : undefined;

      // exactOptionalPropertyTypes: build result, then conditionally set
      // optional fields that may be absent.
      const successResult: ModelEndpointResponse = {
        success: true,
        responseSize,
        latencyMs: Date.now() - startMs,
        opaqueProviderResponse: parsed,
      };
      if (providerModelNameReturned !== undefined) {
        successResult.providerModelNameReturned = providerModelNameReturned as NonEmpty;
      }
      return successResult;
    } finally {
      clearTimeout(timer);
    }
  }
}
