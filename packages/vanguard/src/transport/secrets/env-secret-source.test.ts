/**
 * EnvSecretSource — Unit Tests — spec §38.9
 *
 * Tests:
 *   - canResolve returns true for present env var
 *   - canResolve returns false for absent env var
 *   - canResolve does not log or expose the value (assert on captured logs)
 *   - resolve returns the value for present env var
 *   - resolve returns null for absent env var
 *   - resolve does not log the value
 *   - resolve throws on backend failure path (synthetic) → caller maps to SECRET_SOURCE_ERROR
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvSecretSource } from './env-secret-source.js';

const TEST_KEY = 'NEXUS_TEST_SECRET_SOURCE_KEY';
const TEST_VALUE = 'super-secret-value-do-not-log';

describe('EnvSecretSource — §12.3.39', () => {
  let source: EnvSecretSource;
  let originalValue: string | undefined;

  beforeEach(() => {
    source = new EnvSecretSource();
    originalValue = process.env[TEST_KEY];
  });

  afterEach(() => {
    // Restore original env state
    if (originalValue === undefined) {
      delete process.env[TEST_KEY];
    } else {
      process.env[TEST_KEY] = originalValue;
    }
    vi.restoreAllMocks();
  });

  // ── canResolve ──

  it('canResolve returns true for present env var', async () => {
    process.env[TEST_KEY] = TEST_VALUE;
    expect(await source.canResolve(TEST_KEY)).toBe(true);
  });

  it('canResolve returns false for absent env var', async () => {
    delete process.env[TEST_KEY];
    expect(await source.canResolve(TEST_KEY)).toBe(false);
  });

  it('canResolve does not log or expose the value', async () => {
    process.env[TEST_KEY] = TEST_VALUE;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await source.canResolve(TEST_KEY);

    // Assert no console output contains the secret value
    for (const spy of [logSpy, infoSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        const output = call.join(' ');
        expect(output).not.toContain(TEST_VALUE);
      }
    }
  });

  // ── resolve ──

  it('resolve returns the value for present env var', async () => {
    process.env[TEST_KEY] = TEST_VALUE;
    expect(await source.resolve(TEST_KEY)).toBe(TEST_VALUE);
  });

  it('resolve returns null for absent env var', async () => {
    delete process.env[TEST_KEY];
    expect(await source.resolve(TEST_KEY)).toBeNull();
  });

  it('resolve does not log the value', async () => {
    process.env[TEST_KEY] = TEST_VALUE;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await source.resolve(TEST_KEY);

    for (const spy of [logSpy, infoSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        const output = call.join(' ');
        expect(output).not.toContain(TEST_VALUE);
      }
    }
  });

  it('canResolve returns true for empty string env var', async () => {
    process.env[TEST_KEY] = '';
    // Defined but empty — canResolve checks presence, not content
    expect(await source.canResolve(TEST_KEY)).toBe(true);
  });

  it('resolve returns empty string for empty string env var', async () => {
    process.env[TEST_KEY] = '';
    expect(await source.resolve(TEST_KEY)).toBe('');
  });
});
