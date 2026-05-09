/**
 * Canonicalize Compat Re-Export — spec §38.11, HOLE-S10-001 closure
 *
 * File: tests/manifest/canonicalize-compat-reexport.test.ts
 *
 * Verifies:
 *   1. Physical implementation lives in packages/runtime-utils/src/canonicalize.ts
 *   2. packages/core/src/crypto/canonicalize.ts re-exports from runtime-utils
 *   3. Both entry points return identical results for the same input
 *   4. @nexus/core export compatibility preserved
 */
import { describe, it, expect } from 'vitest';
import { canonicalize as canonicalizeFromCore } from '../../packages/core/src/crypto/canonicalize.js';
import { canonicalize as canonicalizeFromRuntimeUtils } from '../../packages/runtime-utils/src/canonicalize.js';
import { promises as fs } from 'node:fs';

describe('Canonicalize Compat Re-Export (HOLE-S10-001)', () => {
  it('both entry points produce identical output (functional equivalence)', () => {
    // Reference equality (toBe on the function objects) is unreliable under
    // ESM module duplication in Vitest — the same source module can be
    // instantiated twice, producing two distinct function objects with
    // identical bodies. The HOLE-S10-001 closure contract is functional:
    // both entry points must canonicalize identically across all input
    // shapes, regardless of how the module loader resolves them.
    const complex = {
      z: [null, 3, { b: 2, a: 1 }],
      a: 'first',
      nested: { deep: { x: true, a: false } },
    };
    expect(canonicalizeFromCore(complex)).toBe(canonicalizeFromRuntimeUtils(complex));
    expect(canonicalizeFromCore(null)).toBe(canonicalizeFromRuntimeUtils(null));
    expect(canonicalizeFromCore(42)).toBe(canonicalizeFromRuntimeUtils(42));
    expect(canonicalizeFromCore('hello')).toBe(canonicalizeFromRuntimeUtils('hello'));
    expect(canonicalizeFromCore([1, 2, 3])).toBe(canonicalizeFromRuntimeUtils([1, 2, 3]));
  });

  it('both return identical results for a complex object', () => {
    const input = {
      z: 'last',
      a: 'first',
      nested: { b: 2, a: 1 },
      array: [3, 1, 2],
    };
    expect(canonicalizeFromCore(input)).toBe(canonicalizeFromRuntimeUtils(input));
  });

  it('packages/core/src/crypto/canonicalize.ts is a thin re-export', async () => {
    const content = await fs.readFile('packages/core/src/crypto/canonicalize.ts', 'utf-8');
    // Must contain re-export from runtime-utils
    expect(content).toContain('@nexus/runtime-utils');
    // Must be short — a re-export, not a full implementation
    const lines = content
      .trim()
      .split('\n')
      .filter(l => l.trim().length > 0);
    expect(lines.length).toBeLessThan(20);
  });

  it('physical implementation lives in runtime-utils', async () => {
    const content = await fs.readFile('packages/runtime-utils/src/canonicalize.ts', 'utf-8');
    // Must contain the actual implementation (function body, not just re-export)
    expect(content).toContain('function canonicalize');
  });
});
