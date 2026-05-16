/**
 * scripts/dev/_gen-workspace-keys.ts
 *
 * Generates the two workspace-side keys that `nexus init` (cmdInit) does
 * not yet create. Called by scripts/dev/up.sh when either file is missing.
 *
 *   keys/workspace-jwt.secret        — HMAC-SHA256 shared secret for workspace JWTs
 *   keys/workspace-dev-admin.apikey  — api_key value the dev workspace login accepts
 *
 * Idempotent — skips generation when both files already exist.
 *
 * The underscore prefix marks this as a dev-only helper, not a product
 * surface. Production deployments should use the cmdInit / gen-keys paths.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  generateWorkspaceJwtSecret,
  generateDevAdminApiKey,
} from '../../packages/core/src/crypto/key-manager.js';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await fs.mkdir('keys', { recursive: true });

  const jwtPath = path.join('keys', 'workspace-jwt.secret');
  const apiPath = path.join('keys', 'workspace-dev-admin.apikey');

  if (!(await exists(jwtPath))) {
    await generateWorkspaceJwtSecret();
    console.log(`✓ wrote ${jwtPath}`);
  } else {
    console.log(`= ${jwtPath} already present, skipping`);
  }

  if (!(await exists(apiPath))) {
    await generateDevAdminApiKey();
    console.log(`✓ wrote ${apiPath}`);
  } else {
    console.log(`= ${apiPath} already present, skipping`);
  }
}

main().catch(err => {
  console.error('✗ _gen-workspace-keys.ts failed:', err);
  process.exit(1);
});
