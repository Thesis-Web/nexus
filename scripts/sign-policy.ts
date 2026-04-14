/**
 * sign-policy.ts — spec §15.3 + §12.1
 *
 * Signs a PolicyFile JSON with the control-plane key.
 * Reads the file, computes Ed25519 signature over canonicalize(body),
 * writes the signed file back in-place.
 *
 * Usage:
 *   pnpm exec tsx scripts/sign-policy.ts <filepath>
 *
 * Requires: keys/dev.keypair.json (run `pnpm nexus init` first)
 *
 * Law:
 *  - Signature is over canonicalize(all fields except signature)
 *  - JSON.stringify(...sort) is prohibited — canonicalize() is used
 *  - The signed file replaces the original
 */
import { promises as fs } from 'fs';
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';
import { sign }               from '../packages/core/src/crypto/signer.js';
import { canonicalize }       from '../packages/core/src/crypto/canonicalize.js';

async function main(): Promise<void> {
  const filepath = process.argv[2];
  if (!filepath) {
    console.error('Usage: tsx scripts/sign-policy.ts <filepath>');
    process.exit(1);
  }

  let raw: string;
  try {
    raw = await fs.readFile(filepath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read ${filepath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(`Failed to parse JSON from ${filepath}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Strip existing signature if present — we re-sign from scratch
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _existing, ...body } = parsed;

  let controlPlaneKey: Awaited<ReturnType<typeof loadControlPlaneKey>>;
  try {
    controlPlaneKey = await loadControlPlaneKey();
  } catch (err) {
    console.error(
      `Failed to load control-plane key: ${(err as Error).message}\n` +
      `Run 'pnpm nexus init' to generate keys first.`
    );
    process.exit(1);
  }

  const signature = await sign(canonicalize(body), controlPlaneKey);
  const signed    = { ...body, signature };

  await fs.writeFile(filepath, JSON.stringify(signed, null, 2) + '\n', 'utf-8');

  console.log(`✓ Policy file signed: ${filepath}`);
  console.log(`  Signing key: ${controlPlaneKey.publicKey.slice(0, 16)}...`);
  console.log(`  Signature:   ${signature.slice(0, 16)}...`);
}

main().catch(err => {
  console.error('sign-policy.ts fatal:', (err as Error).message);
  process.exit(1);
});
