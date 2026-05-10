/**
 * Unit tests for the per-provider tool-schema translators. Asserts
 * the wire shape each provider expects, so adapters can rely on
 * one canonical translation path.
 */
import { describe, it, expect } from 'vitest';
import type { NonEmpty, ToolSchemaDescriptor } from '@nexus/contracts';
import { toOpenAITools, toOllamaTools, toAnthropicTools } from './tool-schema-translators.js';

const READ_WAREHOUSE: ToolSchemaDescriptor = {
  name: 'read_warehouse' as NonEmpty,
  description: 'Run a SELECT query against the warehouse postgres DB.' as NonEmpty,
  capability: 'read:record:bulk' as NonEmpty,
  target: {
    system: 'warehouse' as NonEmpty,
    resourceType: 'record' as NonEmpty,
    resourceScope: 'bulk' as NonEmpty,
  },
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SQL statement.' },
      params: { type: 'array', description: 'Bind values.' },
    },
    required: ['sql'],
  },
};

const UPDATE_WAREHOUSE: ToolSchemaDescriptor = {
  name: 'update_warehouse' as NonEmpty,
  description: 'Run UPDATE/INSERT/DELETE.' as NonEmpty,
  capability: 'update:record:internal' as NonEmpty,
  target: {
    system: 'warehouse' as NonEmpty,
    resourceType: 'record' as NonEmpty,
    resourceScope: 'single' as NonEmpty,
  },
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string' },
      params: { type: 'array' },
    },
    required: ['sql'],
  },
};

describe('toOpenAITools', () => {
  it('wraps each descriptor in { type: "function", function: { name, description, parameters } }', () => {
    const out = toOpenAITools([READ_WAREHOUSE]);
    expect(out).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_warehouse',
          description: 'Run a SELECT query against the warehouse postgres DB.',
          parameters: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'SQL statement.' },
              params: { type: 'array', description: 'Bind values.' },
            },
            required: ['sql'],
          },
        },
      },
    ]);
  });

  it('preserves multi-tool order', () => {
    const out = toOpenAITools([READ_WAREHOUSE, UPDATE_WAREHOUSE]);
    expect(out).toHaveLength(2);
    expect((out[0] as { function: { name: string } }).function.name).toBe('read_warehouse');
    expect((out[1] as { function: { name: string } }).function.name).toBe('update_warehouse');
  });
});

describe('toOllamaTools', () => {
  it('emits the same envelope as OpenAI today (subject to provider divergence)', () => {
    const openai = toOpenAITools([READ_WAREHOUSE]);
    const ollama = toOllamaTools([READ_WAREHOUSE]);
    expect(ollama).toEqual(openai);
  });
});

describe('toAnthropicTools', () => {
  it('emits a flat { name, description, input_schema } shape', () => {
    const out = toAnthropicTools([READ_WAREHOUSE]);
    expect(out).toEqual([
      {
        name: 'read_warehouse',
        description: 'Run a SELECT query against the warehouse postgres DB.',
        input_schema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL statement.' },
            params: { type: 'array', description: 'Bind values.' },
          },
          required: ['sql'],
        },
      },
    ]);
  });

  it('does not wrap with type: function', () => {
    const out = toAnthropicTools([READ_WAREHOUSE]) as Array<Record<string, unknown>>;
    expect(out[0]!['type']).toBeUndefined();
    expect(out[0]!['function']).toBeUndefined();
  });
});

describe('schema property handling', () => {
  it('passes enum through on string properties', () => {
    const desc: ToolSchemaDescriptor = {
      ...READ_WAREHOUSE,
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['read', 'write'] as const },
        },
        required: ['mode'],
      },
    };
    const out = toOpenAITools([desc]) as Array<{
      function: { parameters: { properties: { mode: { enum: string[] } } } };
    }>;
    expect(out[0]!.function.parameters.properties.mode.enum).toEqual(['read', 'write']);
  });

  it('translates array items with their own type + description', () => {
    const desc: ToolSchemaDescriptor = {
      ...READ_WAREHOUSE,
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', description: 'A tag value.' },
          },
        },
        required: [],
      },
    };
    const out = toAnthropicTools([desc]) as Array<{
      input_schema: { properties: { tags: { items: Record<string, unknown> } } };
    }>;
    expect(out[0]!.input_schema.properties.tags.items).toEqual({
      type: 'string',
      description: 'A tag value.',
    });
  });

  it('omits optional schema fields when absent', () => {
    const desc: ToolSchemaDescriptor = {
      ...READ_WAREHOUSE,
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' }, // no description, no enum, no items
        },
        required: ['q'],
      },
    };
    const out = toOpenAITools([desc]) as Array<{
      function: { parameters: { properties: { q: Record<string, unknown> } } };
    }>;
    const q = out[0]!.function.parameters.properties.q;
    expect(q['type']).toBe('string');
    expect(q['description']).toBeUndefined();
    expect(q['enum']).toBeUndefined();
    expect(q['items']).toBeUndefined();
  });
});
