/**
 * ModelTransportAdapterRegistry — Unit Tests — spec §38.9
 *
 * Tests:
 *   - register / get / list round trip
 *   - duplicate adapterId throws (§12.3.48 invariant 1)
 *   - unregistered adapter returns null on get
 */
import { describe, it, expect } from 'vitest';
import { ModelTransportAdapterRegistry } from './registry.js';
import type {
  ModelTransportAdapter,
  ModelEndpoint,
  ModelEndpointResponse,
  NvgOutboundRequest,
  SecretSource,
  NonEmpty,
} from '@nexus/contracts';

/** Minimal stub adapter satisfying the interface for registry tests. */
function makeStubAdapter(id: string): ModelTransportAdapter<Record<string, unknown>> {
  return {
    adapterId: id as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: {
      safeParse(input: unknown) {
        return { success: true as const, data: input as Record<string, unknown> };
      },
    },
    async invoke(
      _endpoint: ModelEndpoint,
      _request: NvgOutboundRequest,
      _secretSource: SecretSource
    ): Promise<ModelEndpointResponse> {
      return { success: true, responseSize: 0, latencyMs: 0 };
    },
  };
}

describe('ModelTransportAdapterRegistry — §12.3.41, §12.3.48', () => {
  it('register / get / list round trip', () => {
    const registry = new ModelTransportAdapterRegistry();
    const adapter = makeStubAdapter('ollama-chat-v1');

    registry.register(adapter);

    expect(registry.get('ollama-chat-v1')).toBe(adapter);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(adapter);
  });

  it('registers multiple adapters and lists all', () => {
    const registry = new ModelTransportAdapterRegistry();
    const a1 = makeStubAdapter('ollama-chat-v1');
    const a2 = makeStubAdapter('anthropic-messages-v1');
    const a3 = makeStubAdapter('openai-chat-v1');

    registry.register(a1);
    registry.register(a2);
    registry.register(a3);

    expect(registry.list()).toHaveLength(3);
    expect(registry.get('ollama-chat-v1')).toBe(a1);
    expect(registry.get('anthropic-messages-v1')).toBe(a2);
    expect(registry.get('openai-chat-v1')).toBe(a3);
  });

  it('duplicate adapterId throws (§12.3.48 invariant 1)', () => {
    const registry = new ModelTransportAdapterRegistry();
    const adapter = makeStubAdapter('ollama-chat-v1');

    registry.register(adapter);

    expect(() => registry.register(makeStubAdapter('ollama-chat-v1'))).toThrow(
      /duplicate adapterId.*ollama-chat-v1/
    );
  });

  it('unregistered adapter returns null on get', () => {
    const registry = new ModelTransportAdapterRegistry();

    expect(registry.get('nonexistent')).toBeNull();
  });

  it('list returns empty array when no adapters registered', () => {
    const registry = new ModelTransportAdapterRegistry();

    expect(registry.list()).toHaveLength(0);
    expect(registry.list()).toEqual([]);
  });
});
