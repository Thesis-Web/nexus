/**
 * sign-template.ts — AMEND-spec-nexus-compile §5.3
 *
 * Signs a CompileTemplate JSON with the control-plane key.
 * Reads the file, computes templateDigest, Ed25519 signature over digest,
 * writes the signed file back in-place.
 *
 * Usage:
 *   pnpm exec tsx scripts/sign-template.ts <filepath>
 *
 * Requires: keys/dev.keypair.json (run `pnpm nexus init` first)
 *
 * Law:
 *  - templateDigest = sha256(canonicalize({templateId, templateVersion,
 *    format, sections, guards, denialHandling, createdAt, createdBy}))
 *  - signature = sign(templateDigest, controlPlanePrivateKey)
 *  - JSON.stringify(...sort) is prohibited — canonicalize() is used
 *  - The signed file replaces the original
 */
import { promises as fs } from 'fs';
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';
import { sign } from '../packages/core/src/crypto/signer.js';
import { canonicalize } from '../packages/core/src/crypto/canonicalize.js';
import { sha256 } from '../packages/core/src/crypto/signer.js';

async function main(): Promise<void> {
  const filepath = process.argv[2];
  if (!filepath) {
    console.error('Usage: tsx scripts/sign-template.ts <filepath>');
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

  // Strip existing templateDigest and signature — we re-sign from scratch
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { templateDigest: _d, signature: _s, ...body } = parsed;

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

  // Compute templateDigest = sha256(canonicalize(body fields)) [blueprint §11.2]
  const digestInput = {
    templateId: body['templateId'],
    templateVersion: body['templateVersion'],
    format: body['format'],
    sections: body['sections'],
    guards: body['guards'],
    denialHandling: body['denialHandling'],
    createdAt: body['createdAt'],
    createdBy: body['createdBy'],
  };
  const templateDigest = sha256(canonicalize(digestInput));

  // Sign the digest
  const signature = await sign(templateDigest, controlPlaneKey);

  const signed = { ...body, templateDigest, signature };

  await fs.writeFile(filepath, JSON.stringify(signed, null, 2) + '\n', 'utf-8');

  console.log(`✓ Template file signed: ${filepath}`);
  console.log(`  Template:   ${body['templateId']}@${body['templateVersion']}`);
  console.log(`  Digest:     ${templateDigest.slice(0, 16)}...`);
  console.log(`  Signing key: ${controlPlaneKey.publicKey.slice(0, 16)}...`);
  console.log(`  Signature:   ${signature.slice(0, 16)}...`);
}

main().catch(err => {
  console.error('sign-template.ts fatal:', (err as Error).message);
  process.exit(1);
});
