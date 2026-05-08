/**
 * ChainedSecretSource — Unit Tests
 *
 * Tests:
 *   - throws when constructed with an empty source list
 *   - resolve walks sources in order; first non-null wins
 *   - canResolve returns true if any source can resolve
 *   - canResolve tolerates a single source throwing (others may still match)
 *   - resolve propagates a thrown source error to the caller
 *   - never logs or exposes secret values
 */
import { describe, it, expect, vi } from 'vitest';
import type { SecretSource } from '@nexus/contracts';
import { ChainedSecretSource } from './chained-secret-source.js';

function fakeSource(opts: {
  resolveResult?: string | null;
  resolveThrows?: Error;
  canResolveResult?: boolean;
  canResolveThrows?: Error;
}): SecretSource {
  return {
    canResolve: vi.fn(async () => {
      if (opts.canResolveThrows) throw opts.canResolveThrows;
      return opts.canResolveResult ?? false;
    }),
    resolve: vi.fn(async () => {
      if (opts.resolveThrows) throw opts.resolveThrows;
      return opts.resolveResult ?? null;
    }),
  };
}

describe('ChainedSecretSource', () => {
  it('throws when constructed with an empty source list', () => {
    expect(() => new ChainedSecretSource([])).toThrow(/at least one/);
  });

  it('resolve returns the first non-null value', async () => {
    const a = fakeSource({ resolveResult: null });
    const b = fakeSource({ resolveResult: 'value-from-b' });
    const c = fakeSource({ resolveResult: 'value-from-c' });
    const chain = new ChainedSecretSource([a, b, c]);
    expect(await chain.resolve('any-ref')).toBe('value-from-b');
    // c should NOT have been queried — first hit wins.
    expect(c.resolve).not.toHaveBeenCalled();
  });

  it('resolve returns null when no source resolves', async () => {
    const a = fakeSource({ resolveResult: null });
    const b = fakeSource({ resolveResult: null });
    const chain = new ChainedSecretSource([a, b]);
    expect(await chain.resolve('missing-ref')).toBeNull();
  });

  it('resolve treats empty string as not-resolved (continues to next source)', async () => {
    const a = fakeSource({ resolveResult: '' });
    const b = fakeSource({ resolveResult: 'value-from-b' });
    const chain = new ChainedSecretSource([a, b]);
    expect(await chain.resolve('any-ref')).toBe('value-from-b');
  });

  it('canResolve returns true if any source canResolve', async () => {
    const a = fakeSource({ canResolveResult: false });
    const b = fakeSource({ canResolveResult: true });
    const chain = new ChainedSecretSource([a, b]);
    expect(await chain.canResolve('any-ref')).toBe(true);
  });

  it('canResolve returns false if no source canResolve', async () => {
    const a = fakeSource({ canResolveResult: false });
    const b = fakeSource({ canResolveResult: false });
    const chain = new ChainedSecretSource([a, b]);
    expect(await chain.canResolve('any-ref')).toBe(false);
  });

  it('canResolve tolerates a single source throwing', async () => {
    const a = fakeSource({ canResolveThrows: new Error('backend hiccup') });
    const b = fakeSource({ canResolveResult: true });
    const chain = new ChainedSecretSource([a, b]);
    expect(await chain.canResolve('any-ref')).toBe(true);
  });

  it('resolve propagates a thrown source error (caller maps to SECRET_SOURCE_ERROR)', async () => {
    const a = fakeSource({ resolveThrows: new Error('backend explosion') });
    const b = fakeSource({ resolveResult: 'value-from-b' });
    const chain = new ChainedSecretSource([a, b]);
    await expect(chain.resolve('any-ref')).rejects.toThrow(/backend explosion/);
  });
});
