/**
 * Generic Signed Manifest Loader — spec §32a.1
 *
 * Lives in packages/runtime-utils/ (NOT contracts).
 * Provides the shared load path for all four manifest domains (§14.6.2):
 *   1. Read YAML file from manifestPath
 *   2. Parse YAML into envelope
 *   3. Validate envelope shape (manifestVersion, issuer, issuedAt, signature, body)
 *   4. Verify Ed25519 signature over canonicalize(body) using controlPlanePub
 *   5. Parse body against domain-specific bodySchema (Zod)
 *   6. Return typed body
 *
 * Fail-closed: any step failure throws with a buildable operator-readable error.
 * §14.6.1: "An unsigned, invalid-signature, or schema-invalid manifest file is
 * rejected at load time."
 *
 * Imports-into rule (§32a.0): @nexus/contracts, approved Node built-ins,
 * approved external libs only.
 */
import { promises as fs } from 'node:fs';
import { Buffer } from 'node:buffer';
import * as yaml from 'js-yaml';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { z } from 'zod';
import { canonicalize } from '../canonicalize.js';

// @noble/ed25519 v2 requires SHA-512 to be set
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/**
 * Signed manifest envelope schema — validates the outer wrapper shape
 * before signature verification. Domain-specific body validation happens
 * AFTER signature check via the caller-provided bodySchema.
 */
const ManifestEnvelopeSchema = z.object({
  manifestVersion: z.string().min(1),
  issuer: z.string().min(1),
  issuedAt: z.string().min(1),
  signature: z.string().min(1),
  body: z.record(z.unknown()),
});

export interface LoadSignedManifestResult<TBody> {
  readonly manifestVersion: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly body: TBody;
}

/**
 * Load, verify, and parse a signed manifest YAML file.
 *
 * @param manifestPath  Absolute or CWD-relative path to the YAML manifest file
 * @param bodySchema    Domain-specific Zod schema for the manifest body
 * @param controlPlanePub  Base64url-encoded Ed25519 public key (control-plane)
 * @returns Typed manifest body after signature verification + schema validation
 * @throws On any failure — file missing, parse error, bad signature, schema invalid
 */
export async function loadSignedManifest<TBody>(
  manifestPath: string,
  bodySchema: z.ZodSchema<TBody>,
  controlPlanePub: string
): Promise<LoadSignedManifestResult<TBody>> {
  // Step 1: Read file
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Signed manifest load failed: cannot read '${manifestPath}': ${(err as Error).message}`
    );
  }

  // Step 2: Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `Signed manifest load failed: YAML parse error in '${manifestPath}': ${(err as Error).message}`
    );
  }

  // Step 3: Validate envelope shape
  const envelopeResult = ManifestEnvelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    const issues = envelopeResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Signed manifest load failed: envelope shape invalid in '${manifestPath}': ${issues}`
    );
  }
  const envelope = envelopeResult.data;

  // Step 4: Verify Ed25519 signature over canonicalize(body)
  const canonicalBody = canonicalize(envelope.body);
  const sigBytes = base64urlDecode(envelope.signature);
  const msgBytes = new TextEncoder().encode(canonicalBody);
  const pubBytes = base64urlDecode(controlPlanePub);

  let sigValid: boolean;
  try {
    sigValid = await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    throw new Error(
      `Signed manifest load failed: Ed25519 signature verification failed for '${manifestPath}'`
    );
  }

  // Step 5: Parse body against domain-specific schema
  const bodyResult = bodySchema.safeParse(envelope.body);
  if (!bodyResult.success) {
    const issues = bodyResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(
      `Signed manifest load failed: body schema validation failed in '${manifestPath}': ${issues}`
    );
  }

  // Step 6: Return typed result
  return {
    manifestVersion: envelope.manifestVersion,
    issuer: envelope.issuer,
    issuedAt: envelope.issuedAt,
    body: bodyResult.data,
  };
}
