/**
 * Provider tool-call detection — composition-boundary helper (F4.20 NVG
 * return-precheck side).
 *
 * File: scripts/extract-tool-calls.ts
 *
 * Lives at the composition boundary on purpose:
 *   - NVG never inspects payload content (§13.7.1) — it would be a
 *     transport-layer violation to put this inside an adapter.
 *   - The detection result feeds `runDispatchRoundTrip`'s NVG return-
 *     precheck stage: any tool_calls present in the opaque provider
 *     response emit `unsolicited_model_tool_call` and the payload is
 *     treated as text per Spec F4.20 §4.1.
 *
 * The dispatch-to-NXS pattern this helper formerly fed (the §28.1
 * PostInferenceNormalizer) is RETIRED per F4.20 / Q6 — model output
 * cannot trigger NXS. Targeted-system actions go through the
 * planner-authored nxs_dispatch node path only (Spec F4.7). This
 * detector is now a DETECTION-FOR-EVENT helper; the only mutation it
 * triggers is a ledger event emission, never an NXS dispatch.
 *
 * So decoding the three provider shapes (OpenAI tool_calls, Anthropic
 * tool_use blocks, Ollama message.tool_calls) lands here. The
 * functions are pure and side-effect free so they can be unit-tested
 * directly from `extract-tool-calls.test.ts` without a running
 * orchestrator or any DI plumbing.
 */

/**
 * Intermediate representation of a tool call detected in an opaque
 * provider response. Moved here from the retired
 * `@nexus/core` / `PostInferenceNormalizer` module (F4.20 §5.1).
 */
export interface ExtractedToolCall {
  /** Provider tool name. Convention: `verb_target` (e.g. `read_database`). */
  readonly toolName: string;
  /** Tool arguments — opaque to the detector; flows into the
   *  unsolicited-tool-call ledger event detail. */
  readonly arguments: unknown;
  /** Provider-side ID (call_id / tool_use id). Surfaced on the
   *  ledger event so audit can trace which tool turn the model
   *  asked for; the detector itself does nothing else with it. */
  readonly providerCallId: string | null;
}

/**
 * Extract tool calls from an opaque provider response. Returns an
 * empty array for plain-text responses, null/undefined input, and
 * malformed structures — never throws.
 */
export function extractToolCalls(opaqueResponse: unknown): ExtractedToolCall[] {
  if (opaqueResponse === null || opaqueResponse === undefined) return [];
  if (typeof opaqueResponse !== 'object') return [];
  const raw = opaqueResponse as Record<string, unknown>;

  // OpenAI: { choices: [{ message: { tool_calls: [{ id, type:'function',
  //   function: { name, arguments: '<json string>' } }] } }] }
  const choices = raw['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first !== null && typeof first === 'object') {
      const message = (first as Record<string, unknown>)['message'];
      if (message !== null && typeof message === 'object') {
        const toolCalls = (message as Record<string, unknown>)['tool_calls'];
        if (Array.isArray(toolCalls)) {
          const out: ExtractedToolCall[] = [];
          for (const tc of toolCalls) {
            if (tc === null || typeof tc !== 'object') continue;
            const t = tc as Record<string, unknown>;
            const fn = t['function'];
            if (fn === null || typeof fn !== 'object') continue;
            const name = (fn as Record<string, unknown>)['name'];
            if (typeof name !== 'string' || name.length === 0) continue;
            // arguments may be a JSON-encoded string OR an object —
            // OpenAI sends string, some compatibles send objects.
            const argsRaw = (fn as Record<string, unknown>)['arguments'];
            let args: unknown = argsRaw;
            if (typeof argsRaw === 'string') {
              try {
                args = JSON.parse(argsRaw);
              } catch {
                args = argsRaw; // keep as string if it doesn't parse
              }
            }
            const callId = typeof t['id'] === 'string' ? (t['id'] as string) : null;
            out.push({ toolName: name, arguments: args, providerCallId: callId });
          }
          return out;
        }
      }
    }
  }

  // Anthropic: { content: [{ type: 'tool_use', id, name, input: {...} }] }
  const content = raw['content'];
  if (Array.isArray(content) && content.length > 0) {
    const out: ExtractedToolCall[] = [];
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] !== 'tool_use') continue;
      const name = b['name'];
      if (typeof name !== 'string' || name.length === 0) continue;
      const callId = typeof b['id'] === 'string' ? (b['id'] as string) : null;
      out.push({
        toolName: name,
        arguments: b['input'] ?? null,
        providerCallId: callId,
      });
    }
    if (out.length > 0) return out;
    // Fall through: content array without tool_use blocks → not a tool call response.
  }

  // Ollama: { message: { tool_calls: [{ function: { name, arguments } }] } }
  const message = raw['message'];
  if (message !== null && typeof message === 'object') {
    const toolCalls = (message as Record<string, unknown>)['tool_calls'];
    if (Array.isArray(toolCalls)) {
      const out: ExtractedToolCall[] = [];
      for (const tc of toolCalls) {
        if (tc === null || typeof tc !== 'object') continue;
        const t = tc as Record<string, unknown>;
        const fn = t['function'];
        if (fn === null || typeof fn !== 'object') continue;
        const name = (fn as Record<string, unknown>)['name'];
        if (typeof name !== 'string' || name.length === 0) continue;
        const args = (fn as Record<string, unknown>)['arguments'] ?? null;
        const callId = typeof t['id'] === 'string' ? (t['id'] as string) : null;
        out.push({ toolName: name, arguments: args, providerCallId: callId });
      }
      return out;
    }
  }

  return [];
}
