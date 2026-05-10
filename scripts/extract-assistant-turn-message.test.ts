/**
 * Unit tests for extract-assistant-turn-message.
 *
 * Verifies that the helper preserves the assistant turn's tool_calls /
 * tool_use shape across the three provider response families so that a
 * follow-up NVG turn carrying tool_results is well-formed and accepted by
 * the same provider on the second call.
 */
import { describe, it, expect } from 'vitest';
import { extractAssistantTurnMessage } from './extract-assistant-turn-message.js';

describe('extractAssistantTurnMessage', () => {
  it('returns null on null/undefined/non-object input', () => {
    expect(extractAssistantTurnMessage(null)).toBeNull();
    expect(extractAssistantTurnMessage(undefined)).toBeNull();
    expect(extractAssistantTurnMessage('not-an-object')).toBeNull();
    expect(extractAssistantTurnMessage(42)).toBeNull();
  });

  it('returns null on a plain Ollama response with no assistant marker', () => {
    // No `message`, no `choices`, no `role: assistant`. Nothing to echo back.
    expect(extractAssistantTurnMessage({ done: true })).toBeNull();
  });

  // ── Ollama ─────────────────────────────────────────────────────────────

  it('preserves the Ollama assistant message verbatim including tool_calls', () => {
    const ollamaResponse = {
      model: 'qwen2.5:7b',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'read_database',
              arguments: { sql: 'SELECT * FROM products LIMIT 5' },
            },
          },
        ],
      },
      done: true,
    };
    const out = extractAssistantTurnMessage(ollamaResponse);
    expect(out).not.toBeNull();
    expect(out!.role).toBe('assistant');
    expect(out!.content).toBe('');
    expect(out!.tool_calls).toEqual(ollamaResponse.message.tool_calls);
  });

  it('preserves a plain Ollama text-only assistant message', () => {
    const ollamaResponse = {
      message: {
        role: 'assistant',
        content: 'GADGET-Y currently has 150 units in WH-WEST.',
      },
      done: true,
    };
    const out = extractAssistantTurnMessage(ollamaResponse);
    expect(out).not.toBeNull();
    expect(out!.content).toBe('GADGET-Y currently has 150 units in WH-WEST.');
    expect(out!.tool_calls).toBeUndefined();
  });

  // ── OpenAI ─────────────────────────────────────────────────────────────

  it('preserves the OpenAI assistant message including tool_calls and call ids', () => {
    const openaiResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: 'read_database',
                  arguments: '{"sql":"SELECT * FROM products"}',
                },
              },
            ],
          },
        },
      ],
    };
    const out = extractAssistantTurnMessage(openaiResponse);
    expect(out).not.toBeNull();
    expect(out!.role).toBe('assistant');
    // Preserves null content — OpenAI rejects follow-ups missing this exact field.
    expect(out!.content).toBeNull();
    expect(out!.tool_calls).toEqual(openaiResponse.choices[0]!.message.tool_calls);
  });

  it('preserves a plain OpenAI text-only assistant message', () => {
    const openaiResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Inventory query returned 5 rows.',
          },
        },
      ],
    };
    const out = extractAssistantTurnMessage(openaiResponse);
    expect(out).not.toBeNull();
    expect(out!.content).toBe('Inventory query returned 5 rows.');
    expect(out!.tool_calls).toBeUndefined();
  });

  // ── Anthropic ──────────────────────────────────────────────────────────

  it('preserves the Anthropic assistant content blocks for a tool_use turn', () => {
    const anthropicResponse = {
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll check the inventory." },
        {
          type: 'tool_use',
          id: 'toolu_01ABC',
          name: 'read_database',
          input: { sql: 'SELECT * FROM products' },
        },
      ],
      stop_reason: 'tool_use',
    };
    const out = extractAssistantTurnMessage(anthropicResponse);
    expect(out).not.toBeNull();
    expect(out!.role).toBe('assistant');
    // Anthropic content is the structured block array — passed through whole
    // so the next turn's body uses { role: 'assistant', content: [...] }.
    expect(out!.content).toEqual(anthropicResponse.content);
    expect(out!.tool_calls).toBeUndefined();
  });

  it('preserves a plain Anthropic text-only assistant message', () => {
    const anthropicResponse = {
      role: 'assistant',
      content: [{ type: 'text', text: 'GADGET-Y has 150 units.' }],
      stop_reason: 'end_turn',
    };
    const out = extractAssistantTurnMessage(anthropicResponse);
    expect(out).not.toBeNull();
    expect(Array.isArray(out!.content)).toBe(true);
  });
});
