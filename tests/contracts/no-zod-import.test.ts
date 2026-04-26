/**
 * No Zod Import in Contracts — spec §38.11, audit C-B
 *
 * File: tests/contracts/no-zod-import.test.ts
 *
 * Verifies:
 *   1. AST-walk: no file in packages/contracts/src/ imports 'zod'
 *   2. AdapterConfigSchema<TConfig> works with a plain structural object (no Zod)
 *   3. AdapterConfigSchema<TConfig> works with a Zod schema (backward compat)
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AdapterConfigSchema } from '@nexus/contracts';

async function walkTs(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkTs(full)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('No Zod Import in @nexus/contracts (audit C-B)', () => {
  it('no file in packages/contracts/src/ contains import from zod', async () => {
    const files = await walkTs('packages/contracts/src');
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      if (
        /import\s.*from\s+['"]zod['"]/.test(content) ||
        /import\s+['"]zod['"]/.test(content) ||
        /require\s*\(\s*['"]zod['"]\s*\)/.test(content)
      ) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('AdapterConfigSchema works with plain structural object (no Zod)', () => {
    // A plain object that satisfies AdapterConfigSchema<{ foo: string }>
    interface TestConfig {
      foo: string;
    }

    const structuralSchema: AdapterConfigSchema<TestConfig> = {
      safeParse(input: unknown) {
        if (
          typeof input === 'object' &&
          input !== null &&
          'foo' in input &&
          typeof (input as { foo: unknown }).foo === 'string'
        ) {
          return { success: true as const, data: input as TestConfig };
        }
        return {
          success: false as const,
          error: {
            issues: [{ path: ['foo'], message: 'expected string' }],
          },
        };
      },
    };

    const good = structuralSchema.safeParse({ foo: 'bar' });
    expect(good.success).toBe(true);
    if (good.success) expect(good.data.foo).toBe('bar');

    const bad = structuralSchema.safeParse({ foo: 123 });
    expect(bad.success).toBe(false);
  });

  it('AdapterConfigSchema works with Zod schema (backward compat)', () => {
    const zodSchema = z.object({ temperature: z.number().min(0).max(2) }).strict();
    type ZodConfig = z.infer<typeof zodSchema>;

    // Zod's safeParse returns a superset of AdapterConfigSchema's shape
    const asAdapterSchema: AdapterConfigSchema<ZodConfig> = zodSchema;

    const good = asAdapterSchema.safeParse({ temperature: 0.7 });
    expect(good.success).toBe(true);

    const bad = asAdapterSchema.safeParse({ temperature: 5 });
    expect(bad.success).toBe(false);

    const unknown = asAdapterSchema.safeParse({ temperature: 0.7, stream: true });
    expect(unknown.success).toBe(false); // .strict() rejects unknown
  });
});
