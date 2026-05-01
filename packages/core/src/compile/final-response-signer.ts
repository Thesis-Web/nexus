/**
 * Final Response Signer — AMEND-spec §8.3, §8.4, §3.10
 *
 * File: packages/core/src/compile/final-response-signer.ts
 * Layer 1 — signs and verifies FinalResponseArtifact with Ed25519.
 *
 * Sign:
 *   artifact.signature = sign(canonicalize(artifact without signature), signingKey)
 *
 * Verify (§3.10 workspace verification law):
 *   recompute canonical artifact without signature
 *   verify ed25519 signature against the provided public key
 */
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '@nexus/runtime-utils';
import type { FinalResponseArtifact, Base64Url } from '@nexus/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed25519.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export async function signArtifact(
  artifact: Omit<FinalResponseArtifact, 'signature'>,
  privateKey: string
): Promise<Base64Url> {
  const canonical = canonicalize(artifact);
  const msgBytes = new TextEncoder().encode(canonical);
  const keyBytes = new Uint8Array(Buffer.from(privateKey, 'base64url'));
  const sigBytes = await ed25519.signAsync(msgBytes, keyBytes);
  return base64urlEncode(sigBytes) as Base64Url;
}

/**
 * Verify artifact signature — §3.10 workspace verification law.
 *
 * Reconstructs the canonical artifact without its signature field
 * and verifies the ed25519 signature against the provided public key.
 */
export async function verifyArtifactSignature(
  artifact: FinalResponseArtifact,
  publicKey: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _sig, ...rest } = artifact;
  const canonical = canonicalize(rest);
  const msgBytes = new TextEncoder().encode(canonical);
  const sigBytes = new Uint8Array(Buffer.from(artifact.signature, 'base64url'));
  const pubBytes = new Uint8Array(Buffer.from(publicKey, 'base64url'));

  try {
    return await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}
