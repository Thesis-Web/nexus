/**
 * scripts/gen-keys.ts
 *
 * Generates:
 *   keys/dev.keypair.json       — control-plane Ed25519 keypair (dev)
 *   keys/admin.token            — management API bearer token
 *
 * Usage:
 *   pnpm exec tsx scripts/gen-keys.ts
 *   pnpm exec tsx scripts/gen-keys.ts --approver <approverId>
 *
 * Approver key generation writes to keys/approvers/<approverId>.keypair.json.
 */
import {
  generateControlPlaneKeypair,
  generateAdminToken,
  generateApproverKeypair,
  generateWorkspaceJwtSecret,
} from '../packages/core/src/crypto/key-manager.js';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const approverIdx = args.indexOf('--approver');

  if (approverIdx !== -1) {
    const approverId = args[approverIdx + 1];
    if (!approverId) {
      console.error('ERROR: --approver requires an approverId argument');
      process.exit(1);
    }
    const pair = await generateApproverKeypair(approverId);
    console.log(`\nApprover keypair generated:`);
    console.log(`  approverId: ${approverId}`);
    console.log(`  publicKey:  ${pair.publicKey}`);
    console.log(`  path:       keys/approvers/${approverId}.keypair.json`);
    console.log(`  purpose:    ${pair.purpose}`);
    console.log(`\nRegister this approver with:`);
    console.log(`  pnpm nexus approver register --id ${approverId} --public-key ${pair.publicKey}`);
    return;
  }

  // Default: generate control-plane keypair + admin token
  const pair = await generateControlPlaneKeypair();
  console.log(`\nControl-plane keypair generated:`);
  console.log(`  publicKey:  ${pair.publicKey}`);
  console.log(`  path:       keys/dev.keypair.json`);
  console.log(`  purpose:    ${pair.purpose}`);

  const token = await generateAdminToken();
  console.log(`\nAdmin token generated:`);
  console.log(`  path:  keys/admin.token`);
  console.log(`  token: ${token}`);

  const jwtSecret = await generateWorkspaceJwtSecret();
  console.log(`\nWorkspace JWT secret generated:`);
  console.log(`  path:   keys/workspace-jwt.secret`);
  console.log(`  secret: ${jwtSecret.slice(0, 8)}... (truncated)`);
  console.log(`  usage:  workspace session JWT signing (HMAC-SHA256)`);
  console.log(`  note:   env var NEXUS_WORKSPACE_JWT_SECRET overrides file`);
  console.log(`\nWARNING: keys/admin.token and keys/dev.keypair.json are gitignored.`);
  console.log(`         Back them up securely. Run "pnpm ci:gate" to verify the build.`);
}

main().catch(err => {
  console.error('gen-keys failed:', err);
  process.exit(1);
});
