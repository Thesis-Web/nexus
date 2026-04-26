/**
 * Adapter Config Schema Validation — spec §38.11, audit B1/C-C
 *
 * File: tests/manifest/adapter-config-schema-validation.test.ts
 *
 * Verifies per-adapter configSchema validation behavior at manifest load time.
 * Each adapter's .strict() Zod schema rejects unknown fields and validates
 * field types/ranges.
 */
import { describe, it, expect } from 'vitest';
import { OllamaAdapterConfigSchema } from '../../packages/vanguard/src/transport/adapters/ollama-chat-v1.js';
import { AnthropicAdapterConfigSchema } from '../../packages/vanguard/src/transport/adapters/anthropic-messages-v1.js';
import { OpenAiAdapterConfigSchema } from '../../packages/vanguard/src/transport/adapters/openai-chat-v1.js';

describe('Adapter Config Schema Validation (§38.11)', () => {
  // ─── Ollama ───

  describe('Ollama', () => {
    it('accepts options.num_predict inside options bag (audit C-C)', () => {
      const result = OllamaAdapterConfigSchema.safeParse({
        options: { num_predict: 2048 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects num_predict at top level (audit C-C)', () => {
      const result = OllamaAdapterConfigSchema.safeParse({ num_predict: 2048 });
      expect(result.success).toBe(false);
    });

    it('rejects unknown top-level field via .strict()', () => {
      const result = OllamaAdapterConfigSchema.safeParse({ bogus: true });
      expect(result.success).toBe(false);
    });

    it('accepts options as record of unknown (flexible bag)', () => {
      const result = OllamaAdapterConfigSchema.safeParse({
        options: { temperature: 0.7, num_predict: 1024, top_k: 40 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts keep_alive as string', () => {
      const result = OllamaAdapterConfigSchema.safeParse({ keep_alive: '5m' });
      expect(result.success).toBe(true);
    });

    it('accepts keep_alive as number', () => {
      const result = OllamaAdapterConfigSchema.safeParse({ keep_alive: 300 });
      expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
      const result = OllamaAdapterConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ─── Anthropic ───

  describe('Anthropic', () => {
    it('rejects invalid max_tokens (string instead of int)', () => {
      const result = AnthropicAdapterConfigSchema.safeParse({
        max_tokens: 'lots',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown field via .strict()', () => {
      const result = AnthropicAdapterConfigSchema.safeParse({ bogus: true });
      expect(result.success).toBe(false);
    });

    it('accepts valid config with all fields', () => {
      const result = AnthropicAdapterConfigSchema.safeParse({
        max_tokens: 4096,
        system: 'You are a helpful assistant.',
        top_p: 0.9,
        top_k: 40,
        temperature: 0.7,
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
      const result = AnthropicAdapterConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ─── OpenAI ───

  describe('OpenAI', () => {
    it('rejects invalid temperature (out of range)', () => {
      const result = OpenAiAdapterConfigSchema.safeParse({ temperature: 5 });
      expect(result.success).toBe(false);
    });

    it('rejects unknown field via .strict()', () => {
      const result = OpenAiAdapterConfigSchema.safeParse({ bogus: true });
      expect(result.success).toBe(false);
    });

    it('accepts valid config with all fields', () => {
      const result = OpenAiAdapterConfigSchema.safeParse({
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        stop: ['\n'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts stop as string', () => {
      const result = OpenAiAdapterConfigSchema.safeParse({ stop: '\n' });
      expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
      const result = OpenAiAdapterConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ─── Cross-adapter ───

  describe('Cross-adapter', () => {
    it('absent adapterConfig: no validation invoked (undefined passes trivially)', () => {
      // When adapterConfig is absent from manifest entry, the loader
      // skips per-adapter validation. This test documents the contract.
      expect(OllamaAdapterConfigSchema.safeParse({}).success).toBe(true);
      expect(AnthropicAdapterConfigSchema.safeParse({}).success).toBe(true);
      expect(OpenAiAdapterConfigSchema.safeParse({}).success).toBe(true);
    });
  });
});
