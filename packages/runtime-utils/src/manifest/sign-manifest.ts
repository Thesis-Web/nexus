/**
 * Generic Manifest Signing Helper — spec §32a.5
 *
 * Lives in packages/runtime-utils/. Used by the four domain-specific
 * signing scripts under scripts/ to produce signed manifest YAML files.
 *
 * Signing law:
 *   - Signature is Ed25519 over canonicalize(body)
 *   - JSON.stringify(...sort) is PROHIBITED — canonicalize() is used
 *   - The signed manifest is a YAML file with envelope + body
 */
import { Buffer } from 'node:buffer';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '../canonicalize.js';

// @noble/ed25519 v2 requires SHA-512 to be set
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

export interface SignManifestInput {
  /** The domain-specific body to sign */
  readonly body: Record<string, unknown>;
  /** Ed25519 private key, base64url-encoded */
  readonly privateKey: string;
  /** Issuer identifier (e.g. 'nexus-dev') */
  readonly issuer: string;
  /** Manifest version string (e.g. '1.0') */
  readonly manifestVersion: string;
}

export interface SignedManifestEnvelope {
  readonly manifestVersion: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly signature: string;
  readonly body: Record<string, unknown>;
}

/**
 * Sign a manifest body with the control-plane keypair.
 *
 * @returns Complete signed manifest envelope ready for YAML serialization
 */
export async function signManifest(input: SignManifestInput): Promise<SignedManifestEnvelope> {
  const canonicalBody = canonicalize(input.body);
  const msgBytes = new TextEncoder().encode(canonicalBody);
  const privBytes = base64urlDecode(input.privateKey);

  const sigBytes = await ed25519.signAsync(msgBytes, privBytes);
  const signature = base64urlEncode(sigBytes);

  return {
    manifestVersion: input.manifestVersion,
    issuer: input.issuer,
    issuedAt: new Date().toISOString(),
    signature,
    body: input.body,
  };
}
