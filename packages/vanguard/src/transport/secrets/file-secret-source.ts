/**
 * FileSecretSource — beta1 admin onboarding (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC)
 *
 * File: packages/vanguard/src/transport/secrets/file-secret-source.ts
 * Layer 3 — imports from @nexus/contracts only.
 *
 * File-backed SecretSource. Reads a JSON map at the configured path,
 * keyed by upper-snake-case API key names:
 *   { "OPENAI_API_KEY": "sk-...", "ANTHROPIC_API_KEY": "sk-ant-..." }
 *
 * SecretRef format (prefix-routed for chained resolution):
 *   - "file:<KEY_NAME>"  → handled here
 *   - any other shape    → returns null on resolve, false on canResolve
 *                          (foreign prefix; another SecretSource owns it)
 *
 * Reference implementation: plain JSON on disk, gitignored. Production
 * deployments must replace with a Vault/KMS-backed SecretSource.
 *
 * Invariants (same as EnvSecretSource — §12.3.39):
 *   - canResolve: presence-only, never logs or exposes the value.
 *   - resolve: null → caller maps to NVG_TRANSPORT_AUTH_MISSING.
 *   - resolve: throw → caller maps to NVG_TRANSPORT_SECRET_SOURCE_ERROR.
 *   - MUST NOT log or expose secret values in any code path.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SecretSource } from '@nexus/contracts';

export const FILE_SECRET_PREFIX = 'file:';

export class FileSecretSource implements SecretSource {
  private readonly secretsFilePath: string;

  constructor(secretsFilePath: string) {
    this.secretsFilePath = path.resolve(secretsFilePath);
  }

  /** Strip the 'file:' prefix; return null if absent. */
  private parseKeyName(secretRef: string): string | null {
    if (!secretRef.startsWith(FILE_SECRET_PREFIX)) return null;
    const key = secretRef.slice(FILE_SECRET_PREFIX.length);
    return key.length > 0 ? key : null;
  }

  /** Load the JSON map. Returns empty map if file is missing. */
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
      throw new Error(`FileSecretSource: ${this.secretsFilePath} is not valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`FileSecretSource: ${this.secretsFilePath} must be a JSON object`);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

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
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  // ── Admin-write surface (used by admin secret routes) ───────────────────
  // These are the ONLY write paths into keys/secrets.json. The resolver
  // contract above remains read-only.

  /**
   * Write a key into the secrets file. Atomic via temp-file + rename so
   * concurrent reads never see a half-written file. Creates the file (and
   * its parent directory) if missing.
   */
  async writeSecret(keyName: string, keyValue: string): Promise<void> {
    if (!keyName || keyName.length === 0) {
      throw new Error('FileSecretSource.writeSecret: keyName required');
    }
    if (typeof keyValue !== 'string' || keyValue.length === 0) {
      throw new Error('FileSecretSource.writeSecret: keyValue required (non-empty string)');
    }
    const dir = path.dirname(this.secretsFilePath);
    await fs.mkdir(dir, { recursive: true });

    let map: Record<string, string>;
    try {
      map = await this.loadMap();
    } catch {
      // Corrupt or unreadable existing file — refuse to overwrite blindly.
      throw new Error(
        `FileSecretSource.writeSecret: existing ${this.secretsFilePath} is invalid; refusing to overwrite`
      );
    }
    map[keyName] = keyValue;

    const tmp = `${this.secretsFilePath}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(map, null, 2);
    await fs.writeFile(tmp, json, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.secretsFilePath);
    // Best-effort tighten perms (no-op on Windows; ignored on failure).
    try {
      await fs.chmod(this.secretsFilePath, 0o600);
    } catch {
      // ignore
    }
  }

  /**
   * Remove a key from the secrets file. No-op if the key (or file) is absent.
   */
  async deleteSecret(keyName: string): Promise<boolean> {
    let map: Record<string, string>;
    try {
      map = await this.loadMap();
    } catch {
      return false;
    }
    if (!(keyName in map)) return false;
    delete map[keyName];

    const tmp = `${this.secretsFilePath}.tmp-${process.pid}-${Date.now()}`;
    const json = JSON.stringify(map, null, 2);
    await fs.writeFile(tmp, json, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.secretsFilePath);
    try {
      await fs.chmod(this.secretsFilePath, 0o600);
    } catch {
      // ignore
    }
    return true;
  }

  /**
   * List which keys are currently stored. Returns key names only —
   * NEVER returns values.
   */
  async listKeyNames(): Promise<readonly string[]> {
    const map = await this.loadMap();
    return Object.keys(map);
  }

  /** Absolute path of the backing file (used for evidence display). */
  get path(): string {
    return this.secretsFilePath;
  }
}
