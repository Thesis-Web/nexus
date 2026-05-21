/**
 * scripts/dev/_gen-admin-signing-keypair.ts
 *
 * Generates an Ed25519 admin signing keypair for the dev-admin principal,
 * required by:
 *   - SigningCouncilServerSigner (server-side council sign for UI clients)
 *   - AdminMutationServerSigner   (signs SignedAdminMutation envelopes for
 *                                  every admin-writer mutation under F4.13)
 *   - ModeSigner.changeMode       (signs mode envelopes under §9.2 / F4.5)
 *
 * Writes two files per principal:
 *   keys/admins/<principalId>.keypair.json   { publicKey, privateKey, generatedAt, purpose }
 *   keys/admins/<principalId>.public.json    { publicKey }
 *
 * The `.keypair.json` is consumed by loadAdminKeypair (closure in
 * packages/interfaces/cli/src/commands/serve.ts) and by the
 * SigningCouncil dispatchers. The `.public.json` is consumed by
 * loadAdminPublicKey (packages/core/src/modes/mode-manager.ts) for
 * signature verification.
 *
 * Idempotent — skips when both files already exist for the dev-admin
 * principal. The underscore prefix marks this as a dev-only helper, not
 * a product surface; production registers admin keypairs through the
 * admin-writer admin-key upload route.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

// The reference bootstrap dev-admin principalId. Matches the seed in
// packages/core/src/setup/reference-bootstrap.ts and what
// keys/workspace-dev-admin.apikey resolves to in workspace login.
const DEV_ADMIN_PRINCIPAL = '00000000-0000-4000-a000-000000000001';

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function generateForPrincipal(principalId: string): Promise<void> {
  const adminsDir = path.join('keys', 'admins');
  await fs.mkdir(adminsDir, { recursive: true });

  const keypairPath = path.join(adminsDir, `${principalId}.keypair.json`);
  const publicPath = path.join(adminsDir, `${principalId}.public.json`);

  if ((await exists(keypairPath)) && (await exists(publicPath))) {
    console.log(`= ${keypairPath} + ${publicPath} already present, skipping`);
    return;
  }

  const privBytes = ed25519.utils.randomPrivateKey();
  const pubBytes = await ed25519.getPublicKeyAsync(privBytes);

  const keypair = {
    publicKey: b64u(pubBytes),
    privateKey: b64u(privBytes),
    generatedAt: new Date().toISOString(),
    purpose: 'dev' as const,
  };
  const publicOnly = { publicKey: keypair.publicKey };

  await fs.writeFile(keypairPath, JSON.stringify(keypair, null, 2), 'utf-8');
  await fs.writeFile(publicPath, JSON.stringify(publicOnly, null, 2), 'utf-8');
  // .keypair.json contains private key material — owner read/write only.
  await fs.chmod(keypairPath, 0o600);

  console.log(`✓ wrote ${keypairPath}`);
  console.log(`✓ wrote ${publicPath}`);
}

async function main(): Promise<void> {
  await generateForPrincipal(DEV_ADMIN_PRINCIPAL);
}

main().catch(err => {
  console.error('✗ _gen-admin-signing-keypair.ts failed:', err);
  process.exit(1);
});
