/**
 * FileSecretSource — Unit Tests
 *
 * Mirrors EnvSecretSource invariants:
 *   - canResolve: presence only; never logs/exposes the value
 *   - resolve: returns value | null; never logs the value
 *   - canResolve === false / resolve === null when prefix is missing
 *   - throws on malformed JSON (caller maps to SECRET_SOURCE_ERROR)
 *
 * Plus admin write surface:
 *   - writeSecret persists; deleteSecret removes; listKeyNames lists names only
 *   - File perms tightened (best-effort 0600)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSecretSource } from './file-secret-source.js';

const TEST_VALUE = 'sk-do-not-log-this-value-7f3c-9a';

let tmpDir: string;
let secretsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-file-secret-'));
  secretsPath = path.join(tmpDir, 'secrets.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FileSecretSource — beta1 admin onboarding', () => {
  it('resolve returns the value for a stored file: ref', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
  });

  it('canResolve returns true for a stored file: ref', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(true);
  });

  it('canResolve returns false for a missing key in the file', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('file:ANTHROPIC_API_KEY')).toBe(false);
  });

  it('canResolve returns false when the file does not exist', async () => {
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(false);
  });

  it('resolve returns null when the file does not exist', async () => {
    const src = new FileSecretSource(secretsPath);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBeNull();
  });

  it('canResolve returns false for refs without the file: prefix', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('OPENAI_API_KEY')).toBe(false);
    expect(await src.canResolve('env:OPENAI_API_KEY')).toBe(false);
    expect(await src.canResolve('FIXTURE_SYNTHETIC_SECRET:OPENAI_API_KEY')).toBe(false);
  });

  it('resolve returns null for refs without the file: prefix', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.resolve('OPENAI_API_KEY')).toBeNull();
    expect(await src.resolve('env:OPENAI_API_KEY')).toBeNull();
  });

  it('canResolve treats empty-string values as missing (presence-only check excludes empties)', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: '' }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(false);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBeNull();
  });

  it('canResolve treats non-string values as missing', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: 12345 }));
    const src = new FileSecretSource(secretsPath);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(false);
  });

  it('resolve throws on malformed JSON (caller maps to SECRET_SOURCE_ERROR)', async () => {
    await fs.writeFile(secretsPath, 'not-json{{{');
    const src = new FileSecretSource(secretsPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/not valid JSON/);
  });

  it('resolve throws if the JSON is an array, not an object', async () => {
    await fs.writeFile(secretsPath, JSON.stringify(['not', 'an', 'object']));
    const src = new FileSecretSource(secretsPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/JSON object/);
  });

  it('does not log or expose the value on canResolve', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    await src.canResolve('file:OPENAI_API_KEY');
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.join(' ')).not.toContain(TEST_VALUE);
      }
    }
  });

  it('does not log or expose the value on resolve', async () => {
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new FileSecretSource(secretsPath);
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    await src.resolve('file:OPENAI_API_KEY');
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.join(' ')).not.toContain(TEST_VALUE);
      }
    }
  });

  // ── Admin write surface ───────────────────────────────────────────────

  it('writeSecret creates the file with 0600 perms when missing', async () => {
    const src = new FileSecretSource(secretsPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);

    const stat = await fs.stat(secretsPath);
    // Posix-only assertion; on Windows fs.chmod is a no-op so we just
    // verify the file exists and contains the right key.
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
  });

  it('writeSecret preserves other keys', async () => {
    const src = new FileSecretSource(secretsPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    await src.writeSecret('ANTHROPIC_API_KEY', 'sk-ant-9k4e-2');

    const keys = await src.listKeyNames();
    expect(new Set(keys)).toEqual(new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']));
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
    expect(await src.resolve('file:ANTHROPIC_API_KEY')).toBe('sk-ant-9k4e-2');
  });

  it('writeSecret rejects empty keyName / keyValue', async () => {
    const src = new FileSecretSource(secretsPath);
    await expect(src.writeSecret('', TEST_VALUE)).rejects.toThrow(/keyName required/);
    await expect(src.writeSecret('OPENAI_API_KEY', '')).rejects.toThrow(/keyValue required/);
  });

  it('writeSecret refuses to overwrite a corrupt existing file', async () => {
    await fs.writeFile(secretsPath, 'not-json{{{');
    const src = new FileSecretSource(secretsPath);
    await expect(src.writeSecret('OPENAI_API_KEY', TEST_VALUE)).rejects.toThrow(/invalid/);
  });

  it('deleteSecret removes the key and returns true', async () => {
    const src = new FileSecretSource(secretsPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.deleteSecret('OPENAI_API_KEY')).toBe(true);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBeNull();
  });

  it('deleteSecret returns false for an unknown key', async () => {
    const src = new FileSecretSource(secretsPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.deleteSecret('ANTHROPIC_API_KEY')).toBe(false);
  });

  it('deleteSecret returns false when the file is missing', async () => {
    const src = new FileSecretSource(secretsPath);
    expect(await src.deleteSecret('OPENAI_API_KEY')).toBe(false);
  });

  it('listKeyNames returns names only — never values', async () => {
    const src = new FileSecretSource(secretsPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const names = await src.listKeyNames();
    expect(names).toEqual(['OPENAI_API_KEY']);
    for (const name of names) {
      expect(name).not.toContain(TEST_VALUE);
    }
  });
});
