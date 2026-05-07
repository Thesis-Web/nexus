/**
 * ManifestWriterService — SPEC-ADMIN-WRITER §3
 *
 * Generic writer for signed YAML manifest files. Handles:
 *   - Read → parse → mutate body array → re-sign → atomic write
 *   - File-level locking by admin userId (WRITER-004)
 *   - Conflict detection (duplicate IDs on add, missing IDs on update/remove)
 *
 * Layer 1 — packages/core/src/manifest/manifest-writer-service.ts
 *
 * Dependencies:
 *   - signManifest from @nexus/runtime-utils
 *   - js-yaml for YAML read/write
 *   - loadControlPlaneKey from core (passed as constructor arg)
 *
 * Security:
 *   - Re-signs with the same control-plane key used at bootstrap
 *   - Atomic writes (write .tmp → rename) to prevent partial file corruption
 *   - File lock ensures single-writer-at-a-time per manifest
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { signManifest } from '@nexus/runtime-utils';

// ── File Lock (WRITER-004) ──────────────────────────────────────────────────

interface FileLock {
  readonly adminUserId: string;
  readonly acquiredAt: number;
}

/** In-memory lock map. Single-process only; sufficient for MVP on-prem. */
const locks = new Map<string, FileLock>();

const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — stale locks auto-expire

export function acquireLock(
  filePath: string,
  adminUserId: string
): { ok: true } | { ok: false; heldBy: string } {
  const existing = locks.get(filePath);
  if (existing) {
    // Same admin re-acquiring is fine
    if (existing.adminUserId === adminUserId) {
      locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
      return { ok: true };
    }
    // Different admin — check if stale
    if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
      locks.delete(filePath);
      // Fall through to acquire
    } else {
      return { ok: false, heldBy: existing.adminUserId };
    }
  }
  locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
  return { ok: true };
}

export function releaseLock(filePath: string, adminUserId: string): void {
  const existing = locks.get(filePath);
  if (existing && existing.adminUserId === adminUserId) {
    locks.delete(filePath);
  }
}

export function checkLock(filePath: string): FileLock | null {
  const existing = locks.get(filePath);
  if (!existing) return null;
  if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
    locks.delete(filePath);
    return null;
  }
  return existing;
}

// ── ManifestWriterService ───────────────────────────────────────────────────

export interface ManifestWriterConfig {
  /** Ed25519 private key, base64url-encoded */
  readonly privateKey: string;
  /** Issuer identifier (e.g. 'nexus-dev') */
  readonly issuer: string;
}

export class ManifestWriterService {
  private readonly privateKey: string;
  private readonly issuer: string;

  constructor(config: ManifestWriterConfig) {
    this.privateKey = config.privateKey;
    this.issuer = config.issuer;
  }

  /**
   * Read the current entries from a manifest file.
   */
  async readEntries(manifestPath: string, arrayKey: string): Promise<Record<string, unknown>[]> {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const body = parsed['body'] as Record<string, unknown> | undefined;
    if (!body) throw new Error(`Manifest ${manifestPath} has no body`);
    const arr = body[arrayKey];
    if (!Array.isArray(arr)) return [];
    return arr as Record<string, unknown>[];
  }

  /**
   * Add an entry to a manifest's body array.
   * @throws 409 if entry with same ID already exists
   */
  async addEntry(
    manifestPath: string,
    arrayKey: string,
    entry: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]> {
    const { body, manifestVersion } = await this.readManifest(manifestPath);
    const arr = (body[arrayKey] as Record<string, unknown>[]) ?? [];
    const entryId = entry[idKey];
    if (arr.some(e => e[idKey] === entryId)) {
      throw Object.assign(new Error(`Entry ${String(entryId)} already exists`), {
        statusCode: 409,
      });
    }
    arr.push(entry);
    body[arrayKey] = arr;
    await this.writeManifest(manifestPath, body, manifestVersion);
    return arr;
  }

  /**
   * Update an existing entry in a manifest's body array.
   * @throws 404 if entry not found
   */
  async updateEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    updates: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]> {
    const { body, manifestVersion } = await this.readManifest(manifestPath);
    const arr = (body[arrayKey] as Record<string, unknown>[]) ?? [];
    const idx = arr.findIndex(e => e[idKey] === entryId);
    if (idx === -1) {
      throw Object.assign(new Error(`Entry ${entryId} not found`), { statusCode: 404 });
    }
    arr[idx] = { ...arr[idx], ...updates };
    body[arrayKey] = arr;
    await this.writeManifest(manifestPath, body, manifestVersion);
    return arr;
  }

  /**
   * Remove an entry from a manifest's body array.
   * @throws 404 if entry not found
   */
  async removeEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    idKey: string
  ): Promise<Record<string, unknown>[]> {
    const { body, manifestVersion } = await this.readManifest(manifestPath);
    const arr = (body[arrayKey] as Record<string, unknown>[]) ?? [];
    const idx = arr.findIndex(e => e[idKey] === entryId);
    if (idx === -1) {
      throw Object.assign(new Error(`Entry ${entryId} not found`), { statusCode: 404 });
    }
    arr.splice(idx, 1);
    body[arrayKey] = arr;
    await this.writeManifest(manifestPath, body, manifestVersion);
    return arr;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async readManifest(manifestPath: string): Promise<{
    body: Record<string, unknown>;
    manifestVersion: string;
  }> {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const body = parsed['body'];
    if (!body || typeof body !== 'object') {
      throw new Error(`Manifest ${manifestPath} has no body or body is not an object`);
    }
    const manifestVersion =
      typeof parsed['manifestVersion'] === 'string' ? parsed['manifestVersion'] : '1.0';
    // Return a mutable shallow copy of body
    return { body: { ...(body as Record<string, unknown>) }, manifestVersion };
  }

  private async writeManifest(
    manifestPath: string,
    body: Record<string, unknown>,
    manifestVersion: string
  ): Promise<void> {
    const envelope = await signManifest({
      body,
      privateKey: this.privateKey,
      issuer: this.issuer,
      manifestVersion,
    });
    const yamlOutput = yaml.dump(envelope, {
      lineWidth: -1,
      quotingType: "'",
      forceQuotes: false,
      sortKeys: false,
      noRefs: true,
    });
    // Atomic write: .tmp → rename
    const tmpPath = manifestPath + '.tmp';
    await fs.writeFile(tmpPath, yamlOutput, 'utf-8');
    await fs.rename(tmpPath, manifestPath);
  }
}
