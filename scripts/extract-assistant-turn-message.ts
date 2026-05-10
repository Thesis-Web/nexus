/**
 * Provider assistant-turn extraction — composition-boundary helper.
 *
 * File: scripts/extract-assistant-turn-message.ts
 *
 * Sibling to `extract-tool-calls.ts` and `extractAssistantContent`. When the
 * orchestrator's tool-call round-trip needs to send a follow-up turn back to
 * the same provider, it must include the assistant's prior tool-call message
 * in the next request's `messages` array — otherwise providers reject the
 * follow-up because the tool_result messages have no preceding tool_call to
 * correlate against.
 *
 * Each provider expects a different shape for that assistant message:
 *
 *   - Ollama:    { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments } }] }
 *   - OpenAI:    { role: 'assistant', content: null,
 *                  tool_calls: [{ id, type: 'function', function: { name, arguments: '<json>' } }] }
 *   - Anthropic: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }, ...] }
 *
 * Lives at the composition boundary on purpose:
 *   - NVG never inspects payload content (§13.7.1) — putting this inside an
 *     adapter would be a transport-layer violation.
 *   - The function is pure and side-effect-free so it can be unit-tested
 *     directly without a running orchestrator or DI plumbing.
 *
 * Returns null when the provider response carries no assistant turn that
 * needs to be echoed back (e.g. plain text response with no tool_calls).
 * Round-trip callers only call this helper when there ARE tool_calls to
 * dispatch; null in that case indicates a malformed/unrecognised response
 * shape and the caller can surface it as a round-trip failure.
 */

/**
 * The shape of one entry the round-trip caller appends to `messages` before
 * sending the next NVG turn. `unknown` for content because each provider
 * uses a different content shape (string for Ollama/OpenAI, structured
 * blocks for Anthropic). The transport adapter passes the value through to
 * the provider unmodified — so as long as we mirror what the provider
 * returned, the round-trip stays well-formed.
 */
export interface AssistantTurnMessage {
  readonly role: 'assistant';
  readonly content: unknown;
  readonly tool_calls?: unknown;
}

export function extractAssistantTurnMessage(opaqueResponse: unknown): AssistantTurnMessage | null {
  if (opaqueResponse === null || opaqueResponse === undefined) return null;
  if (typeof opaqueResponse !== 'object') return null;
  const raw = opaqueResponse as Record<string, unknown>;

  // Ollama: { message: { role: 'assistant', content, tool_calls? } }
  // The message blob is shaped exactly the way Ollama wants to receive it
  // back, so pass it through verbatim (mirroring what came in is the
  // only behavior that survives provider quirks like content='' for
  // tool-only turns).
  const ollamaMsg = raw['message'];
  if (ollamaMsg !== null && typeof ollamaMsg === 'object') {
    const m = ollamaMsg as Record<string, unknown>;
    if (m['role'] === 'assistant' || m['tool_calls'] !== undefined) {
      const out: AssistantTurnMessage = {
        role: 'assistant',
        content: m['content'] ?? '',
        ...(m['tool_calls'] !== undefined ? { tool_calls: m['tool_calls'] } : {}),
      };
      return out;
    }
  }

  // OpenAI: { choices: [{ message: { role: 'assistant', content, tool_calls? } }] }
  const choices = raw['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first !== null && typeof first === 'object') {
      const cm = (first as Record<string, unknown>)['message'];
      if (cm !== null && typeof cm === 'object') {
        const m = cm as Record<string, unknown>;
        if (m['role'] === 'assistant' || m['tool_calls'] !== undefined) {
          const out: AssistantTurnMessage = {
            role: 'assistant',
            // OpenAI uses `content: null` on tool-only turns; preserve.
            content: m['content'] === undefined ? null : m['content'],
            ...(m['tool_calls'] !== undefined ? { tool_calls: m['tool_calls'] } : {}),
          };
          return out;
        }
      }
    }
  }

  // Anthropic: { role: 'assistant', content: [...], stop_reason: 'tool_use' | ... }
  // Anthropic returns the full message envelope at the top level; content is
  // an array of typed blocks. Echo the content array back unchanged — the
  // transport adapter will wrap it as { role: 'assistant', content: [...] }.
  const topRole = raw['role'];
  const topContent = raw['content'];
  if (topRole === 'assistant' && Array.isArray(topContent)) {
    return { role: 'assistant', content: topContent };
  }

  return null;
}
