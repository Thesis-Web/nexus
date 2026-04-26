/**
 * Transport Adapter Types — spec §12.3.37, §12.3.40
 *
 * File: packages/contracts/src/interfaces/transport-adapter.ts
 *
 * DIFF-BUILD-001: Spec references separate files for ModelEndpoint,
 * ModelEndpointResponse, NvgOutboundRequest. Current repo consolidates all
 * interfaces in index.ts. New transport types live in dedicated files;
 * existing types are modified in-place in index.ts. Type-only imports from
 * index.ts are safe against circular re-export.
 */
import type { NonEmpty } from '../types/index.js';
import type { ModelEndpoint, ModelEndpointResponse, NvgOutboundRequest } from './index.js';
import type { SecretSource } from './secret-source.js';
import type { AdapterConfigSchema } from './adapter-config-schema.js';

// ─── §12.3.37 ModelTransportAdapterId ───
/**
 * Open governed string. One adapter per provider wire-format family.
 *
 * Reserved IDs (registered by reference adapters at bootstrap):
 *   'ollama-chat-v1'         — Ollama POST /api/chat
 *   'anthropic-messages-v1'  — Anthropic POST /v1/messages
 *   'openai-chat-v1'         — OpenAI / OpenAI-compatible POST /v1/chat/completions
 */
export type ModelTransportAdapterId = NonEmpty;

// ─── §12.3.40 ModelTransportAdapter ───
/**
 * Mechanical provider dispatch. Adapter:
 *   1. Resolves auth via secretSource.resolve(...)
 *   2. Constructs provider-required request body and headers (EXPLICIT, no spread)
 *   3. Issues HTTP POST via globalThis.fetch with timeout covering fetch + body read
 *   4. Maps provider HTTP status → governed denial code per §12.2
 *   5. On success: returns with opaqueProviderResponse
 *   6. On failure: returns with denialCode + reason
 *
 * Adapter MUST NOT inspect, classify, redact, summarize, truncate, cache,
 * replay, or mutate semantic payload content.
 *
 * Adapter MUST request non-streaming responses (§13.6.2).
 */
export interface ModelTransportAdapter<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly adapterId: ModelTransportAdapterId;
  readonly adapterVersion: NonEmpty;

  /**
   * Per-adapter configuration schema (§12.3.40 configSchema; audit B1).
   * Validated at MANIFEST LOAD time (§26.5 Step 6.5).
   * Type is AdapterConfigSchema<TConfig> — structural, zod-not-in-contracts.
   */
  readonly configSchema: AdapterConfigSchema<TConfig>;

  invoke(
    endpoint: ModelEndpoint,
    request: NvgOutboundRequest,
    secretSource: SecretSource
  ): Promise<ModelEndpointResponse>;
}
