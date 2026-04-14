/**
 * MCP intent extractor — spec §19.2, §10.3.6
 *
 * Extracts IntentContext from incoming MCP HTTP request headers.
 * No environment header is read — that is intentionally absent per §19.2 adapter law.
 * Values are sanitized per spec field constraints:
 *   objectiveSummary  max 500 chars
 *   riskNote          max 200 chars
 *
 * Blueprint: nexus-blueprint-v0-3-6.md §5.4 (adapter environment non-override law)
 * Spec: nexus-engineering-spec-v0-4-6.md §10.3.6, §19.2
 */

import type { IntentContext, IsoTimestamp } from '@nexus/core';

/** Sanitize a string to a maximum length, trimming whitespace. */
function sanitize(value: string | undefined | null, maxLen: number): string | null {
  if (value == null || value.trim().length === 0) return null;
  return value.trim().slice(0, maxLen);
}

/**
 * Extract a header value from an IncomingMessage-like headers map.
 * Header names are matched case-insensitively (HTTP/1.1 canonical lower-case).
 */
function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const key = name.toLowerCase();
  const val = headers[key];
  if (val == null) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

export interface McpRequestHeaders {
  [key: string]: string | string[] | undefined;
}

/**
 * extractIntentContext
 *
 * Builds an IntentContext from the MCP request headers and tool name.
 * Caller supplies the adapter name+version string as toolchainContext.
 * extractedAt is stamped by this function using nowIso().
 *
 * @param headers       HTTP request headers (lower-cased, Node.js IncomingMessage style)
 * @param toolName      The MCP tool name from the request body
 * @param adapterLabel  e.g. "mcp-adapter/v0.1.0" — becomes toolchainContext
 * @param nowIso        Injected timestamp function (enables deterministic testing)
 */
export function extractIntentContext(
  headers: McpRequestHeaders,
  toolName: string,
  adapterLabel: string,
  nowIso: () => IsoTimestamp
): IntentContext {
  const modelId = extractHeader(headers, 'x-nexus-model-id');
  const rawConfidence = extractHeader(headers, 'x-nexus-model-confidence');
  const riskNoteRaw = extractHeader(headers, 'x-nexus-risk-note');

  let modelConfidence: number | null = null;
  if (rawConfidence != null) {
    const parsed = parseFloat(rawConfidence);
    // Clamp to [0,1] per spec §10.3.6
    if (!isNaN(parsed)) {
      modelConfidence = Math.min(1, Math.max(0, parsed));
    }
  }

  // objectiveSummary: derive from tool name; max 500 chars
  const rawSummary = `mcp tool call: ${toolName}`;
  const objectiveSummary =
    sanitize(rawSummary, 500) ?? `mcp tool call: ${toolName.slice(0, 480)}`;

  // riskNote: from header; max 200 chars; null if absent or blank
  const riskNote = sanitize(riskNoteRaw, 200);

  return {
    objectiveSummary,
    triggeringSource: 'unknown',      // MCP calls are adapter-initiated; source unknown
    toolchainContext: adapterLabel,
    modelId:          modelId ?? null,
    modelConfidence,
    riskNote,
    extractedAt:      nowIso(),
  };
}
