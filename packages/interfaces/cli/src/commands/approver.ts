import { generateApproverKeypair } from '@nexus/core';
import type { NonEmpty } from '@nexus/core';
export async function cmdApproverKeygen(approverId: string): Promise<void> {
  const pair = await generateApproverKeypair(approverId as NonEmpty);
  console.log(`✓ keys/approvers/${approverId}.keypair.json written`);
  console.log(`  publicKey: ${pair.publicKey.slice(0, 16)}...`);
}
