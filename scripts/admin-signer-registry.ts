/**
 * FileBackedAdminSignerRegistry — WS-BOOTSTRAP
 *
 * Implements AdminSignerRegistry (contracts §workspace-governed.ts)
 * by reading admin public keys from the filesystem directory
 * `keys/admins/<signerId>.public.json`.
 *
 * Spec reference: §9.2 HOLE-002 closure — admin identity binding via
 * filesystem key directory.
 *
 * Lives in scripts/ (composition root) — NOT inside any layered package.
 * Hard rule 32: admin signers ≠ approver keys.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AdminSignerRegistry } from '@nexus/contracts';

export class FileBackedAdminSignerRegistry implements AdminSignerRegistry {
  private readonly keysDir: string;

  constructor(keysDir: string = path.join(process.cwd(), 'keys', 'admins')) {
    this.keysDir = keysDir;
  }

  async getPublicKey(signerId: string): Promise<string | null> {
    const keyPath = path.join(this.keysDir, `${signerId}.public.json`);
    try {
      const raw = fs.readFileSync(keyPath, 'utf-8');
      const parsed = JSON.parse(raw) as { publicKey?: string };
      return parsed.publicKey ?? null;
    } catch {
      return null;
    }
  }

  async isRegistered(signerId: string): Promise<boolean> {
    const key = await this.getPublicKey(signerId);
    return key !== null;
  }
}
