import { generateControlPlaneKeypair, generateAdminToken } from '@nexus/core';
export async function cmdInit(): Promise<void> {
  const pair = await generateControlPlaneKeypair();
  const token = await generateAdminToken();
  console.log('✓ keys/dev.keypair.json written');
  console.log(`  publicKey: ${pair.publicKey.slice(0, 16)}...`);
  console.log('✓ keys/admin.token written');
  console.log(`  token: ${token.slice(0, 8)}...`);
}
