/**
 * extractToolCalls — Unit Tests
 *
 * CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §6.
 *
 * Three provider response shapes covered + edge cases. The function
 * is pure and side-effect free, so these tests are direct calls.
 */

import { describe, it, expect } from 'vitest';
import { extractToolCalls } from './extract-tool-calls.js';

describe('extractToolCalls', () => {
  // ── OpenAI shape ────────────────────────────────────────────────────────
  it('extracts from OpenAI tool_calls (function name + JSON arguments string)', () => {
    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'read_database',
                  arguments: '{"table":"customers","limit":10}',
                },
              },
            ],
          },
        },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('read_database');
    expect(calls[0]!.providerCallId).toBe('call_1');
    // JSON-encoded arguments string is parsed for the caller.
    expect(calls[0]!.arguments).toEqual({ table: 'customers', limit: 10 });
  });

  it('extracts multiple OpenAI tool calls in a single response', () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } },
              { id: 'b', type: 'function', function: { name: 'two', arguments: '{}' } },
            ],
          },
        },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls.map(c => c.toolName)).toEqual(['one', 'two']);
  });

  it('keeps non-JSON OpenAI arguments as a string (does not lose data)', () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'ok', arguments: 'not_json' } },
            ],
          },
        },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls[0]!.arguments).toBe('not_json');
  });

  // ── Anthropic shape ─────────────────────────────────────────────────────
  it('extracts from Anthropic tool_use blocks', () => {
    const response = {
      content: [
        { type: 'text', text: 'I need to read the database.' },
        {
          type: 'tool_use',
          id: 'toolu_xyz',
          name: 'read_database',
          input: { table: 'orders' },
        },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('read_database');
    expect(calls[0]!.providerCallId).toBe('toolu_xyz');
    expect(calls[0]!.arguments).toEqual({ table: 'orders' });
  });

  it('extracts multiple Anthropic tool_use blocks', () => {
    const response = {
      content: [
        { type: 'tool_use', id: 'a', name: 'first', input: { k: 1 } },
        { type: 'tool_use', id: 'b', name: 'second', input: { k: 2 } },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls.map(c => c.toolName)).toEqual(['first', 'second']);
  });

  // ── Ollama shape ────────────────────────────────────────────────────────
  it('extracts from Ollama message.tool_calls', () => {
    const response = {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'search_docs',
              arguments: { query: 'foo' },
            },
          },
        ],
      },
    };
    const calls = extractToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('search_docs');
    expect(calls[0]!.arguments).toEqual({ query: 'foo' });
    // Ollama tool_calls don't always carry an id — providerCallId is null.
    expect(calls[0]!.providerCallId).toBeNull();
  });

  // ── Empty / non-tool-call paths ─────────────────────────────────────────
  it('returns [] for a plain-text OpenAI response', () => {
    const response = {
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
    };
    expect(extractToolCalls(response)).toEqual([]);
  });

  it('returns [] for a plain-text Anthropic response (text-only content)', () => {
    const response = { content: [{ type: 'text', text: 'Hi' }] };
    expect(extractToolCalls(response)).toEqual([]);
  });

  it('returns [] for a plain-text Ollama response', () => {
    const response = { message: { role: 'assistant', content: 'ok' } };
    expect(extractToolCalls(response)).toEqual([]);
  });

  // ── Defensive cases — robust against null/garbage ───────────────────────
  it('returns [] for null', () => {
    expect(extractToolCalls(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(extractToolCalls(undefined)).toEqual([]);
  });

  it('returns [] for a string', () => {
    expect(extractToolCalls('not an object')).toEqual([]);
  });

  it('returns [] for an empty object', () => {
    expect(extractToolCalls({})).toEqual([]);
  });

  it('skips malformed tool calls without crashing (mixed valid/invalid)', () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [
              { broken: true }, // no function
              { function: 'string-not-object' }, // bad function shape
              { function: { name: '' } }, // empty name
              {
                id: 'good',
                type: 'function',
                function: { name: 'ok', arguments: '{}' },
              },
            ],
          },
        },
      ],
    };
    const calls = extractToolCalls(response);
    // Only the well-formed entry survives.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe('ok');
  });

  it('does not throw when a non-tool-use block sits next to a tool_use', () => {
    const response = {
      content: [
        { type: 'tool_use', id: 'a', name: 'first', input: {} },
        { type: 'image', source: { url: 'https://example.com' } },
        { type: 'tool_use', id: 'b', name: 'second', input: {} },
      ],
    };
    const calls = extractToolCalls(response);
    expect(calls.map(c => c.toolName)).toEqual(['first', 'second']);
  });
});
