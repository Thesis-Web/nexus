/**
 * nexus init — spec §22.1
 * Generate dev keypair + admin token + default mode configuration.
 *
 * §9.2: ModeConfiguration created with valid Ed25519 signature at init time.
 * HOLE-S9-001 owner ruling: strict default posture.
 *   - default mode: enforcing (both NXS and NVG)
 *   - default lock posture: enforcing-lock ON
 *   - mode changeable only through signed admin path (§9.3)
 */
import { generateControlPlaneKeypair, generateAdminToken, saveModeConfig } from '@nexus/core';
import type { NonEmpty, IsoTimestamp, Base64Url, ModeConfiguration } from '@nexus/core';
import { OPERATING_MODE } from '@nexus/core';
import { sign } from '@nexus/core';
import { canonicalize } from '@nexus/core';
import type { KeyPair } from '@nexus/core';

export async function cmdInit(): Promise<void> {
  const pair = await generateControlPlaneKeypair();
  const token = await generateAdminToken();
  console.log('✓ keys/dev.keypair.json written');
  console.log(`  publicKey: ${pair.publicKey.slice(0, 16)}...`);
  console.log('✓ keys/admin.token written');
  console.log(`  token: ${token.slice(0, 8)}...`);

  // §9.2 + HOLE-S9-001: Create strict default signed ModeConfiguration
  const now = new Date().toISOString() as IsoTimestamp;
  const adminId = 'dev-admin' as NonEmpty;
  const modeBody = {
    nxsMode: OPERATING_MODE.ENFORCING,
    nvgMode: OPERATING_MODE.ENFORCING,
    enforcingLocked: true,
    updatedAt: now,
    updatedBy: { adminId, publicKey: pair.publicKey as Base64Url },
  };
  const signature = await sign(canonicalize(modeBody), pair);
  const modeConfig: ModeConfiguration = {
    ...modeBody,
    signature: signature as Base64Url,
  };
  await saveModeConfig(modeConfig);
  console.log('✓ keys/mode-config.json written (enforcing/enforcing, locked)');
}
