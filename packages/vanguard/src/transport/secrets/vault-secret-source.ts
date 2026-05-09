/**
 * VaultSecretSource — beta1 admin onboarding (CLAUDE-CODE-VAULT-SECRET-SOURCE)
 *
 * File: packages/vanguard/src/transport/secrets/vault-secret-source.ts
 * Layer 3 — imports from @nexus/contracts and node:crypto only.
 *
 * AES-256-GCM-encrypted SecretSource. Same on-disk shape as FileSecretSource
 * (a JSON map keyed by upper-snake-case names) but every value is
 * authenticated-encrypted at rest. The 256-bit symmetric key lives in a
 * separate file so that filesystem read access to keys/secrets.json alone
 * does not reveal API keys.
 *
 * Encrypted value format:
 *   vault:v1:<nonce-hex>:<ciphertext-hex>:<tag-hex>
 *
 * Vault key file (keys/vault.key):
 *   { "version": 1, "algorithm": "aes-256-gcm",
 *     "key": "<base64 of 32 random bytes>",
 *     "generatedAt": "<ISO 8601>" }
 *
 * Invariants — same as FileSecretSource (§12.3.39):
 *   - canResolve: presence-only, never logs or exposes the value.
 *   - resolve: null → caller maps to NVG_TRANSPORT_AUTH_MISSING.
 *   - resolve: throw → caller maps to NVG_TRANSPORT_SECRET_SOURCE_ERROR.
 *   - MUST NOT log or expose plaintext (or ciphertext) in any code path.
 *   - Fail-closed: missing or corrupt vault key file throws on first use.
 *
 * SecretRef format (prefix-routed, identical to FileSecretSource):
 *   - "file:<KEY_NAME>" → handled here
 *   - any other shape   → null on resolve, false on canResolve
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SecretSource } from '@nexus/contracts';

export const VAULT_PREFIX = 'vault:v1:';
export const FILE_SECRET_PREFIX = 'file:';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VAULT_KEY_VERSION = 1;

interface VaultKeyFileV1 {
  readonly version: 1;
  readonly algorithm: 'aes-256-gcm';
  readonly key: string; // base64-encoded 32 bytes
  readonly generatedAt: string; // ISO 8601
}

/**
 * Load `keys/vault.key`; if absent, generate a fresh 256-bit key and write
 * it atomically with 0600 perms. Idempotent: existing keys are preserved.
 *
 * Returns the absolute path to the vault key file. Bootstrap should call
 * this BEFORE constructing VaultSecretSource so the constructor's first
 * use does not race against generation.
 *
 * @throws if the parent directory cannot be created or the file cannot be
 *   written (filesystem failure — fail-closed at startup).
 */
export async function ensureVaultKey(vaultKeyPath: string): Promise<{
  readonly path: string;
  readonly generated: boolean;
}> {
  const resolved = path.resolve(vaultKeyPath);
  try {
    await fs.access(resolved);
    return { path: resolved, generated: false };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENOENT') throw err;
  }

  const keyBytes = randomBytes(KEY_BYTES);
  const payload: VaultKeyFileV1 = {
    version: VAULT_KEY_VERSION,
    algorithm: ALGORITHM,
    key: keyBytes.toString('base64'),
    generatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(resolved), { recursive: true });

  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  await fs.rename(tmp, resolved);
  try {
    await fs.chmod(resolved, 0o600);
  } catch {
    // Windows / unsupported FS — best-effort; perms tightening is not load-bearing
    // for correctness, only for defense-in-depth.
  }

  return { path: resolved, generated: true };
}

export class VaultSecretSource implements SecretSource {
  private readonly secretsFilePath: string;
  private readonly vaultKeyPath: string;
  private vaultKey: Buffer | null = null;

  constructor(secretsFilePath: string, vaultKeyPath: string) {
    this.secretsFilePath = path.resolve(secretsFilePath);
    this.vaultKeyPath = path.resolve(vaultKeyPath);
  }

  /** Strip the 'file:' prefix; return null if absent. */
  private parseKeyName(secretRef: string): string | null {
    if (!secretRef.startsWith(FILE_SECRET_PREFIX)) return null;
    const key = secretRef.slice(FILE_SECRET_PREFIX.length);
    return key.length > 0 ? key : null;
  }

  /**
   * Load the 32-byte symmetric key from disk. Cached after first load —
   * the key is fixed at install time and does not rotate during a process
   * lifetime. Fail-closed: any structural or filesystem error throws.
   */
  private async loadVaultKey(): Promise<Buffer> {
    if (this.vaultKey !== null) return this.vaultKey;
    let raw: string;
    try {
      raw = await fs.readFile(this.vaultKeyPath, 'utf-8');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') {
        throw new Error(
          `VaultSecretSource: vault key file missing at ${this.vaultKeyPath} ` +
            `(run nexus init or restart bootstrap to generate)`
        );
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`VaultSecretSource: ${this.vaultKeyPath} is not valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`VaultSecretSource: ${this.vaultKeyPath} must be a JSON object`);
    }
    const obj = parsed as Record<string, unknown>;
    if (obj['version'] !== VAULT_KEY_VERSION) {
      throw new Error(
        `VaultSecretSource: ${this.vaultKeyPath} has unsupported version ` +
          `${String(obj['version'])} (expected ${VAULT_KEY_VERSION})`
      );
    }
    if (obj['algorithm'] !== ALGORITHM) {
      throw new Error(
        `VaultSecretSource: ${this.vaultKeyPath} algorithm '${String(obj['algorithm'])}' ` +
          `unsupported (expected ${ALGORITHM})`
      );
    }
    if (typeof obj['key'] !== 'string' || obj['key'].length === 0) {
      throw new Error(`VaultSecretSource: ${this.vaultKeyPath} missing 'key' field`);
    }
    let keyBuf: Buffer;
    try {
      keyBuf = Buffer.from(obj['key'], 'base64');
    } catch {
      throw new Error(`VaultSecretSource: ${this.vaultKeyPath} 'key' is not valid base64`);
    }
    if (keyBuf.length !== KEY_BYTES) {
      throw new Error(
        `VaultSecretSource: ${this.vaultKeyPath} key length ${keyBuf.length} ` +
          `bytes, expected ${KEY_BYTES}`
      );
    }
    this.vaultKey = keyBuf;
    return keyBuf;
  }

  /** Load the JSON map from disk. Returns empty map if file is missing. */
  private async loadMap(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.secretsFilePath, 'utf-8');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') return {};
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`VaultSecretSource: ${this.secretsFilePath} is not valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`VaultSecretSource: ${this.secretsFilePath} must be a JSON object`);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  /** Atomically rewrite the secrets map (temp file + rename, 0600 perms). */
  private async writeMap(map: Record<string, string>): Promise<void> {
    await fs.mkdir(path.dirname(this.secretsFilePath), { recursive: true });
    const tmp = `${this.secretsFilePath}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(map, null, 2);
    await fs.writeFile(tmp, json, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.secretsFilePath);
    try {
      await fs.chmod(this.secretsFilePath, 0o600);
    } catch {
      // ignore — Windows / best-effort
    }
  }

  private isEncrypted(value: string): boolean {
    return value.startsWith(VAULT_PREFIX);
  }

  private encrypt(plaintext: string, key: Buffer): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VAULT_PREFIX}${nonce.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
  }

  private decrypt(encoded: string, key: Buffer): string {
    if (!encoded.startsWith(VAULT_PREFIX)) {
      throw new Error('VaultSecretSource: malformed ciphertext (missing vault:v1: prefix)');
    }
    const body = encoded.slice(VAULT_PREFIX.length);
    const parts = body.split(':');
    if (parts.length !== 3) {
      throw new Error('VaultSecretSource: malformed ciphertext (expected 3 hex segments)');
    }
    const [nonceHex, ctHex, tagHex] = parts as [string, string, string];
    const nonce = Buffer.from(nonceHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    if (nonce.length !== NONCE_BYTES) {
      throw new Error(
        `VaultSecretSource: malformed ciphertext (nonce length ${nonce.length}, expected ${NONCE_BYTES})`
      );
    }
    if (tag.length !== TAG_BYTES) {
      throw new Error(
        `VaultSecretSource: malformed ciphertext (tag length ${tag.length}, expected ${TAG_BYTES})`
      );
    }
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf-8');
  }

  // ── SecretSource interface ────────────────────────────────────────────

  async canResolve(secretRef: string): Promise<boolean> {
    const key = this.parseKeyName(secretRef);
    if (key === null) return false;
    const map = await this.loadMap();
    const v = map[key];
    return typeof v === 'string' && v.length > 0;
  }

  async resolve(secretRef: string): Promise<string | null> {
    const key = this.parseKeyName(secretRef);
    if (key === null) return null;
    const map = await this.loadMap();
    const v = map[key];
    if (typeof v !== 'string' || v.length === 0) return null;
    if (!this.isEncrypted(v)) {
      // Pre-migration plaintext value. Return as-is (read path is
      // side-effect-free; migration is the only path that mutates).
      return v;
    }
    const vaultKey = await this.loadVaultKey();
    return this.decrypt(v, vaultKey);
  }

  // ── Admin-write surface (mirrors FileSecretSource) ────────────────────

  async writeSecret(keyName: string, keyValue: string): Promise<void> {
    if (!keyName || keyName.length === 0) {
      throw new Error('VaultSecretSource.writeSecret: keyName required');
    }
    if (typeof keyValue !== 'string' || keyValue.length === 0) {
      throw new Error('VaultSecretSource.writeSecret: keyValue required (non-empty string)');
    }
    let map: Record<string, string>;
    try {
      map = await this.loadMap();
    } catch {
      throw new Error(
        `VaultSecretSource.writeSecret: existing ${this.secretsFilePath} is invalid; refusing to overwrite`
      );
    }
    const vaultKey = await this.loadVaultKey();
    map[keyName] = this.encrypt(keyValue, vaultKey);
    await this.writeMap(map);
  }

  async deleteSecret(keyName: string): Promise<boolean> {
    let map: Record<string, string>;
    try {
      map = await this.loadMap();
    } catch {
      return false;
    }
    if (!(keyName in map)) return false;
    delete map[keyName];
    await this.writeMap(map);
    return true;
  }

  async listKeyNames(): Promise<readonly string[]> {
    const map = await this.loadMap();
    return Object.keys(map);
  }

  /** Absolute path of the backing secrets file (used for evidence display). */
  get path(): string {
    return this.secretsFilePath;
  }

  // ── Migration ─────────────────────────────────────────────────────────

  /**
   * Encrypt any plaintext values left over from the pre-vault era. Idempotent —
   * already-encrypted values are left untouched. Called once at bootstrap.
   *
   * Migration is an infrastructure action, not an admin action: it does NOT
   * emit per-key audit events. Bootstrap logs a single line summary.
   *
   * @returns count of values encrypted by this call
   */
  async migrateToEncrypted(): Promise<{ readonly migrated: number }> {
    const map = await this.loadMap();
    const vaultKey = await this.loadVaultKey();
    let count = 0;
    for (const [key, value] of Object.entries(map)) {
      if (!this.isEncrypted(value) && value.length > 0) {
        map[key] = this.encrypt(value, vaultKey);
        count++;
      }
    }
    if (count > 0) {
      await this.writeMap(map);
    }
    return { migrated: count };
  }
}
