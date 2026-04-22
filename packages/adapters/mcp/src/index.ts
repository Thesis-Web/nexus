/**
 * MCP Adapter — Layer 4 barrel export
 * Exports adapter + proxy components only. Layer 2 imports only.
 *
 * MODULAR-S29-001: Composition root (mcp-server.ts) moved to scripts/.
 * This package contains normalization and proxy code — no cross-layer wiring.
 */
export { McpAdapter } from './mcp-normalizer.js';
export { NexusMcpProxy } from './mcp-proxy.js';
export type { ProxyDependencies } from './mcp-proxy.js';
export { extractIntentContext } from './mcp-intent-extractor.js';
