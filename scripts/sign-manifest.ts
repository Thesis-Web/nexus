/**
 * sign-manifest.ts — spec §32a.5
 *
 * Signs a manifest YAML file with the control-plane key.
 * Reads the file, extracts the body, computes Ed25519 signature over
 * canonicalize(body), writes the signed envelope back as YAML.
 *
 * Usage:
 *   pnpm exec tsx scripts/sign-manifest.ts <manifest-path>
 *
 * Examples:
 *   pnpm exec tsx scripts/sign-manifest.ts config/identity/providers.v1.yaml
 *   pnpm exec tsx scripts/sign-manifest.ts config/nvg/endpoints.v1.yaml
 *   pnpm exec tsx scripts/sign-manifest.ts config/connectors/connectors.v1.yaml
 *   pnpm exec tsx scripts/sign-manifest.ts config/channels/channels.v1.yaml
 *
 * Requires: keys/dev.keypair.json (run `pnpm nexus init` first)
 *
 * DIFF-NISP-001.A-D1: Spec §32a.5 says "four signing scripts." This is one
 * parameterized script invoked four ways — functionally identical, avoids
 * code duplication. Each invocation wraps the shared signManifest helper
 * from @nexus/runtime-utils.
 *
 * Law:
 *  - Signature is over canonicalize(body) via signManifest
 *  - JSON.stringify(...sort) is PROHIBITED — canonicalize() is used
 *  - The signed file replaces the original
 */
import { promises as fs } from 'node:fs';
import * as yaml from 'js-yaml';
import { signManifest } from '../packages/runtime-utils/src/manifest/sign-manifest.js';
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: tsx scripts/sign-manifest.ts <manifest-path>');
    console.error('');
    console.error('Examples:');
    console.error('  pnpm exec tsx scripts/sign-manifest.ts config/identity/providers.v1.yaml');
    console.error('  pnpm exec tsx scripts/sign-manifest.ts config/nvg/endpoints.v1.yaml');
    console.error('  pnpm exec tsx scripts/sign-manifest.ts config/connectors/connectors.v1.yaml');
    console.error('  pnpm exec tsx scripts/sign-manifest.ts config/channels/channels.v1.yaml');
    process.exit(1);
  }

  // 1. Read existing manifest YAML
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read ${manifestPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(`Failed to parse YAML from ${manifestPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Extract body — must be present
  const body = parsed['body'];
  if (body === undefined || body === null || typeof body !== 'object') {
    console.error(`Manifest ${manifestPath} has no 'body' field or body is not an object.`);
    process.exit(1);
  }

  // 3. Extract manifestVersion (default '1.0' if absent)
  const manifestVersion =
    typeof parsed['manifestVersion'] === 'string' ? parsed['manifestVersion'] : '1.0';

  // 4. Load control-plane keypair
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

  // 5. Sign via signManifest (runtime-utils)
  const envelope = await signManifest({
    body: body as Record<string, unknown>,
    privateKey: controlPlaneKey.privateKey,
    issuer: 'nexus-dev',
    manifestVersion,
  });

  // 6. Write signed YAML back in-place
  const yamlOutput = yaml.dump(envelope, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false,
    sortKeys: false,
    noRefs: true,
  });

  await fs.writeFile(manifestPath, yamlOutput, 'utf-8');

  console.log(`✓ Manifest signed: ${manifestPath}`);
  console.log(`  Signing key: ${controlPlaneKey.publicKey.slice(0, 16)}...`);
  console.log(`  Signature:   ${envelope.signature.slice(0, 16)}...`);
}

main().catch(err => {
  console.error('sign-manifest.ts fatal:', (err as Error).message);
  process.exit(1);
});
