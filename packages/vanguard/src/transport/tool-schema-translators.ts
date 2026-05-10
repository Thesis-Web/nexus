// packages/vanguard/src/transport/tool-schema-translators.ts
//
// Phase C buildToolDefinitions, part 2 of 4.
//
// Provider-neutral ToolSchemaDescriptor → provider-specific tool wire
// format. Each adapter (ollama-chat-v1, openai-chat-v1,
// anthropic-messages-v1) calls its corresponding translator before
// constructing the outbound body, so the descriptor shape is the only
// thing the orchestrator needs to attach to NvgOutboundRequest.payload.
//
// Layer rule: vanguard is the transport tier — adapter code lives here
// alongside its provider-specific framing. ToolSchemaDescriptor itself
// lives in @nexus/contracts and is provider-neutral.
//
// All three providers accept JSON-Schema-shaped tool input (draft-07
// compatible), so the per-property translation is a noop — the
// difference is only in the OUTER envelope:
//
//   OpenAI / Ollama: { type: 'function', function: { name, description, parameters } }
//   Anthropic:       { name, description, input_schema }
//
// Returns `unknown[]` because the adapter forwards opaque to the
// provider — TypeScript can't reasonably type the provider's
// per-version tool shape, but the runtime structure is well-defined
// per provider docs.

import type { ToolSchemaDescriptor, ToolInputSchema } from '@nexus/contracts';

/** OpenAI Chat Completions / function-calling format (also used by Ollama). */
export function toOpenAITools(descriptors: readonly ToolSchemaDescriptor[]): unknown[] {
  return descriptors.map(d => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: jsonSchemaFromInput(d.inputSchema),
    },
  }));
}

/** Ollama chat tool format — identical envelope to OpenAI today. */
export function toOllamaTools(descriptors: readonly ToolSchemaDescriptor[]): unknown[] {
  return toOpenAITools(descriptors);
}

/** Anthropic Messages API tool format — flatter envelope, no wrapper. */
export function toAnthropicTools(descriptors: readonly ToolSchemaDescriptor[]): unknown[] {
  return descriptors.map(d => ({
    name: d.name,
    description: d.description,
    input_schema: jsonSchemaFromInput(d.inputSchema),
  }));
}

// ─── Internal: descriptor.inputSchema → JSON Schema draft-07 object ───
// All three providers want the same property shape; the differences
// were once in `additionalProperties` defaults and `enum` handling but
// modern provider SDKs accept the canonical form below.

function jsonSchemaFromInput(schema: ToolInputSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const out: Record<string, unknown> = { type: prop.type };
    if (prop.description !== undefined) out['description'] = prop.description;
    if (prop.enum !== undefined) out['enum'] = [...prop.enum];
    if (prop.items !== undefined) {
      const itemOut: Record<string, unknown> = { type: prop.items.type };
      if (prop.items.description !== undefined) itemOut['description'] = prop.items.description;
      if (prop.items.enum !== undefined) itemOut['enum'] = [...prop.items.enum];
      out['items'] = itemOut;
    }
    properties[key] = out;
  }
  return {
    type: 'object',
    properties,
    required: [...schema.required],
  };
}
