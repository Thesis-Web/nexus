/**
 * scripts/dev/_gen-user-ladder-keys.ts
 *
 * Generates one API key per ladder role at keys/users/<role>.apikey
 * (perms 0600). Idempotent — skips files that already exist.
 *
 * Spec: AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md §2.
 *
 * Run via:  pnpm exec tsx scripts/dev/_gen-user-ladder-keys.ts
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { USER_LADDER } from '../seeds/user-ladder-seeds.js';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = path.join('keys', 'users');
  await fs.mkdir(root, { recursive: true });
  for (const spec of USER_LADDER) {
    const target = path.join(root, `${spec.role}.apikey`);
    if (await exists(target)) {
      console.log(`= ${target} already present, skipping`);
      continue;
    }
    const apiKey = randomBytes(32).toString('base64url');
    await fs.writeFile(target, apiKey, { encoding: 'utf-8', mode: 0o600 });
    console.log(`✓ wrote ${target}  (actor ${spec.actorId})`);
  }
}

main().catch(err => {
  console.error('✗ _gen-user-ladder-keys.ts failed:', err);
  process.exit(1);
});
