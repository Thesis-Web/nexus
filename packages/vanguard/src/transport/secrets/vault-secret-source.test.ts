/**
 * VaultSecretSource — Unit Tests
 *
 * Coverage matches CLAUDE-CODE-VAULT-SECRET-SOURCE §9.1:
 *  1. canResolve returns true for stored, false for missing
 *  2. canResolve returns false for non-`file:` refs
 *  3. resolve returns decrypted plaintext for encrypted values
 *  4. resolve returns plaintext for unencrypted values (pre-migration compat)
 *  5. resolve returns null for missing keys
 *  6. writeSecret encrypts and stores; subsequent resolve returns original
 *  7. writeSecret produces unique ciphertext on repeated calls (nonce uniqueness)
 *  8. deleteSecret removes; subsequent resolve returns null
 *  9. listKeyNames returns names without values
 * 10. migrateToEncrypted encrypts plaintext, leaves encrypted alone
 * 11. Tampered ciphertext throws on resolve (GCM auth failure)
 * 12. Missing vault key file throws on resolve
 * 13. Corrupt vault key file throws on resolve
 * 14. Empty keyName / keyValue throws
 * 15. Atomic write: temp file + rename (no .tmp residue, perms tightened)
 *
 * Plus log-non-leakage and ensureVaultKey behavior parity with FileSecretSource.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  VaultSecretSource,
  ensureVaultKey,
  VAULT_PREFIX,
} from './vault-secret-source.js';

const TEST_VALUE = 'sk-do-not-log-this-value-7f3c-9a';
const SECOND_VALUE = 'sk-ant-second-value-1d2e-4b';

let tmpDir: string;
let secretsPath: string;
let vaultKeyPath: string;

async function writeVaultKey(): Promise<void> {
  const key = randomBytes(32).toString('base64');
  const payload = {
    version: 1,
    algorithm: 'aes-256-gcm',
    key,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(vaultKeyPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-vault-secret-'));
  secretsPath = path.join(tmpDir, 'secrets.json');
  vaultKeyPath = path.join(tmpDir, 'vault.key');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('VaultSecretSource — encryption-at-rest secret source', () => {
  // ── Test 1+5: canResolve / resolve presence semantics ────────────────────

  it('canResolve returns true for a stored file: ref (encrypted value)', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(true);
  });

  it('canResolve returns false for a missing key in the file', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.canResolve('file:ANTHROPIC_API_KEY')).toBe(false);
  });

  it('canResolve returns false when the secrets file does not exist', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    expect(await src.canResolve('file:OPENAI_API_KEY')).toBe(false);
  });

  it('resolve returns null when the secrets file does not exist', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBeNull();
  });

  // ── Test 2: prefix routing ─────────────────────────────────────────────

  it('canResolve returns false for refs without the file: prefix', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.canResolve('OPENAI_API_KEY')).toBe(false);
    expect(await src.canResolve('env:OPENAI_API_KEY')).toBe(false);
    expect(await src.canResolve('vault:v1:OPENAI_API_KEY')).toBe(false);
  });

  it('resolve returns null for refs without the file: prefix', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.resolve('OPENAI_API_KEY')).toBeNull();
    expect(await src.resolve('env:OPENAI_API_KEY')).toBeNull();
  });

  // ── Test 3: round-trip ─────────────────────────────────────────────────

  it('resolve returns decrypted plaintext for encrypted values (round-trip)', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
  });

  it('writeSecret stores ciphertext on disk (not plaintext)', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const onDisk = await fs.readFile(secretsPath, 'utf-8');
    expect(onDisk).not.toContain(TEST_VALUE);
    expect(onDisk).toContain(VAULT_PREFIX);
  });

  // ── Test 4: pre-migration plaintext compatibility ──────────────────────

  it('resolve returns plaintext value as-is when not yet migrated', async () => {
    await writeVaultKey();
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: TEST_VALUE }));
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    // Pre-migration: stored value is plaintext (no vault:v1: prefix). Read
    // path stays side-effect-free and returns it.
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
  });

  // ── Test 7: nonce uniqueness ───────────────────────────────────────────

  it('writeSecret produces unique ciphertext on repeated writes (random nonces)', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const first = JSON.parse(await fs.readFile(secretsPath, 'utf-8'))['OPENAI_API_KEY'];
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const second = JSON.parse(await fs.readFile(secretsPath, 'utf-8'))['OPENAI_API_KEY'];
    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect(first).not.toBe(second);
    // But both decrypt to the same plaintext.
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
  });

  it('writeSecret preserves other keys', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    await src.writeSecret('ANTHROPIC_API_KEY', SECOND_VALUE);

    const keys = await src.listKeyNames();
    expect(new Set(keys)).toEqual(new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']));
    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
    expect(await src.resolve('file:ANTHROPIC_API_KEY')).toBe(SECOND_VALUE);
  });

  // ── Test 8: deleteSecret ───────────────────────────────────────────────

  it('deleteSecret removes the key and returns true', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.deleteSecret('OPENAI_API_KEY')).toBe(true);
    expect(await src.resolve('file:OPENAI_API_KEY')).toBeNull();
  });

  it('deleteSecret returns false for an unknown key', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    expect(await src.deleteSecret('ANTHROPIC_API_KEY')).toBe(false);
  });

  it('deleteSecret returns false when the secrets file is missing', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    expect(await src.deleteSecret('OPENAI_API_KEY')).toBe(false);
  });

  // ── Test 9: listKeyNames returns names only ────────────────────────────

  it('listKeyNames returns names only — never values', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const names = await src.listKeyNames();
    expect(names).toEqual(['OPENAI_API_KEY']);
    for (const name of names) {
      expect(name).not.toContain(TEST_VALUE);
    }
  });

  // ── Test 10: migration ────────────────────────────────────────────────

  it('migrateToEncrypted encrypts plaintext values and counts them', async () => {
    await writeVaultKey();
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        OPENAI_API_KEY: TEST_VALUE,
        ANTHROPIC_API_KEY: SECOND_VALUE,
      })
    );
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    const result = await src.migrateToEncrypted();
    expect(result.migrated).toBe(2);

    const onDisk = JSON.parse(await fs.readFile(secretsPath, 'utf-8'));
    expect((onDisk['OPENAI_API_KEY'] as string).startsWith(VAULT_PREFIX)).toBe(true);
    expect((onDisk['ANTHROPIC_API_KEY'] as string).startsWith(VAULT_PREFIX)).toBe(true);

    expect(await src.resolve('file:OPENAI_API_KEY')).toBe(TEST_VALUE);
    expect(await src.resolve('file:ANTHROPIC_API_KEY')).toBe(SECOND_VALUE);
  });

  it('migrateToEncrypted is idempotent — already-encrypted values left alone', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);
    const before = JSON.parse(await fs.readFile(secretsPath, 'utf-8'))['OPENAI_API_KEY'];

    const result = await src.migrateToEncrypted();
    expect(result.migrated).toBe(0);

    const after = JSON.parse(await fs.readFile(secretsPath, 'utf-8'))['OPENAI_API_KEY'];
    expect(after).toBe(before);
  });

  it('migrateToEncrypted skips empty-string values', async () => {
    await writeVaultKey();
    await fs.writeFile(secretsPath, JSON.stringify({ OPENAI_API_KEY: '' }));
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    const result = await src.migrateToEncrypted();
    expect(result.migrated).toBe(0);
  });

  it('migrateToEncrypted returns 0 when the secrets file is missing', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    const result = await src.migrateToEncrypted();
    expect(result.migrated).toBe(0);
  });

  // ── Test 11: tamper detection ──────────────────────────────────────────

  it('resolve throws on tampered ciphertext (GCM authentication failure)', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);

    // Flip a single character in the ciphertext-hex segment. The format is
    // vault:v1:<nonce>:<ct>:<tag> — index by colon segments.
    const map = JSON.parse(await fs.readFile(secretsPath, 'utf-8'));
    const original = map['OPENAI_API_KEY'] as string;
    const body = original.slice(VAULT_PREFIX.length);
    const [nonceHex, ctHex, tagHex] = body.split(':') as [string, string, string];
    // Flip the first hex char of ciphertext (a→b or 0→1).
    const flipped =
      ctHex[0] === 'a'
        ? 'b' + ctHex.slice(1)
        : ctHex[0] === '0'
          ? '1' + ctHex.slice(1)
          : '0' + ctHex.slice(1);
    map['OPENAI_API_KEY'] = `${VAULT_PREFIX}${nonceHex}:${flipped}:${tagHex}`;
    await fs.writeFile(secretsPath, JSON.stringify(map));

    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow();
  });

  it('resolve throws on malformed ciphertext (wrong segment count)', async () => {
    await writeVaultKey();
    await fs.writeFile(
      secretsPath,
      JSON.stringify({ OPENAI_API_KEY: `${VAULT_PREFIX}only-two:segments` })
    );
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/malformed/);
  });

  // ── Test 12+13: vault key file failures ────────────────────────────────

  it('resolve throws when the vault key file is missing (fail-closed)', async () => {
    // Note: vault key file is intentionally NOT written.
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    // Need an encrypted value to force loadVaultKey to be called. Build one
    // by pre-encrypting via a sibling instance with a real key, then deleting
    // the key file before resolving. Alternative: just inject an obviously-
    // formatted vault:v1: value the decryptor will still try to decrypt with.
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        OPENAI_API_KEY: `${VAULT_PREFIX}${'00'.repeat(12)}:${'00'.repeat(16)}:${'00'.repeat(16)}`,
      })
    );
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/vault key file missing/);
  });

  it('resolve throws when the vault key file is not valid JSON', async () => {
    await fs.writeFile(vaultKeyPath, 'not-json{{{');
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        OPENAI_API_KEY: `${VAULT_PREFIX}${'00'.repeat(12)}:${'00'.repeat(16)}:${'00'.repeat(16)}`,
      })
    );
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/not valid JSON/);
  });

  it('resolve throws when the vault key file has the wrong key length', async () => {
    const shortKey = randomBytes(16).toString('base64'); // 128 bits, not 256
    await fs.writeFile(
      vaultKeyPath,
      JSON.stringify({
        version: 1,
        algorithm: 'aes-256-gcm',
        key: shortKey,
        generatedAt: new Date().toISOString(),
      })
    );
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        OPENAI_API_KEY: `${VAULT_PREFIX}${'00'.repeat(12)}:${'00'.repeat(16)}:${'00'.repeat(16)}`,
      })
    );
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/key length/);
  });

  it('resolve throws when the vault key file declares an unsupported version', async () => {
    const key = randomBytes(32).toString('base64');
    await fs.writeFile(
      vaultKeyPath,
      JSON.stringify({
        version: 99,
        algorithm: 'aes-256-gcm',
        key,
        generatedAt: new Date().toISOString(),
      })
    );
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        OPENAI_API_KEY: `${VAULT_PREFIX}${'00'.repeat(12)}:${'00'.repeat(16)}:${'00'.repeat(16)}`,
      })
    );
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.resolve('file:OPENAI_API_KEY')).rejects.toThrow(/unsupported version/);
  });

  // ── Test 14: input validation ──────────────────────────────────────────

  it('writeSecret rejects empty keyName / keyValue', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.writeSecret('', TEST_VALUE)).rejects.toThrow(/keyName required/);
    await expect(src.writeSecret('OPENAI_API_KEY', '')).rejects.toThrow(/keyValue required/);
  });

  it('writeSecret refuses to overwrite a corrupt existing secrets file', async () => {
    await writeVaultKey();
    await fs.writeFile(secretsPath, 'not-json{{{');
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await expect(src.writeSecret('OPENAI_API_KEY', TEST_VALUE)).rejects.toThrow(/invalid/);
  });

  // ── Test 15: atomic write ─────────────────────────────────────────────

  it('writeSecret leaves no .tmp- residue and tightens perms to 0600', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);

    const dirEntries = await fs.readdir(tmpDir);
    const stragglers = dirEntries.filter(name => name.includes('.tmp-'));
    expect(stragglers).toEqual([]);

    if (process.platform !== 'win32') {
      const stat = await fs.stat(secretsPath);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  // ── Log non-leakage ───────────────────────────────────────────────────

  it('does not log or expose the plaintext value on resolve', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);

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

  it('does not log or expose the plaintext value on canResolve', async () => {
    await writeVaultKey();
    const src = new VaultSecretSource(secretsPath, vaultKeyPath);
    await src.writeSecret('OPENAI_API_KEY', TEST_VALUE);

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
});

describe('ensureVaultKey — install/bootstrap-time key generation', () => {
  it('generates a fresh vault key when missing', async () => {
    const result = await ensureVaultKey(vaultKeyPath);
    expect(result.generated).toBe(true);

    const raw = await fs.readFile(vaultKeyPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.algorithm).toBe('aes-256-gcm');
    expect(typeof parsed.key).toBe('string');
    expect(Buffer.from(parsed.key, 'base64').length).toBe(32);
    expect(typeof parsed.generatedAt).toBe('string');
    expect(new Date(parsed.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('preserves an existing vault key (idempotent)', async () => {
    await writeVaultKey();
    const before = await fs.readFile(vaultKeyPath, 'utf-8');

    const result = await ensureVaultKey(vaultKeyPath);
    expect(result.generated).toBe(false);

    const after = await fs.readFile(vaultKeyPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('writes the vault key with 0600 perms on POSIX', async () => {
    await ensureVaultKey(vaultKeyPath);
    if (process.platform !== 'win32') {
      const stat = await fs.stat(vaultKeyPath);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('creates the parent directory if missing', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c', 'vault.key');
    await ensureVaultKey(nested);
    const stat = await fs.stat(nested);
    expect(stat.isFile()).toBe(true);
  });

  it('two ensureVaultKey calls produce different keys when run in fresh dirs', async () => {
    // Smoke test: random key generation actually randomizes.
    const path1 = path.join(tmpDir, 'a.key');
    const path2 = path.join(tmpDir, 'b.key');
    await ensureVaultKey(path1);
    await ensureVaultKey(path2);
    const k1 = JSON.parse(await fs.readFile(path1, 'utf-8')).key;
    const k2 = JSON.parse(await fs.readFile(path2, 'utf-8')).key;
    expect(k1).not.toBe(k2);
  });
});
