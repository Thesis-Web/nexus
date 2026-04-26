/**
 * NVG Transport Layer — barrel export
 *
 * File: packages/vanguard/src/transport/index.ts
 * Layer 3 — NVG model transport adapters, registry, and manifest loading.
 */

// ── Registry ────────────────────────────────────────────────────────────────
export { ModelTransportAdapterRegistry } from './registry.js';

// ── Secret Sources ──────────────────────────────────────────────────────────
export { EnvSecretSource } from './secrets/env-secret-source.js';

// ── Reference Adapters ──────────────────────────────────────────────────────
export {
  OllamaChatV1Adapter,
  OllamaAdapterConfigSchema,
  type OllamaAdapterConfig,
} from './adapters/ollama-chat-v1.js';
export {
  AnthropicMessagesV1Adapter,
  AnthropicAdapterConfigSchema,
  type AnthropicAdapterConfig,
} from './adapters/anthropic-messages-v1.js';
export {
  OpenAiChatV1Adapter,
  OpenAiAdapterConfigSchema,
  type OpenAiAdapterConfig,
} from './adapters/openai-chat-v1.js';

// ── Endpoint Manifest ───────────────────────────────────────────────────────
export {
  EndpointManifestEntrySchema,
  EndpointManifestBodySchema,
} from './endpoints/endpoint-manifest-schema.js';
export {
  loadEndpointManifest,
  type LoadEndpointManifestOptions,
} from './endpoints/endpoint-manifest-loader.js';
