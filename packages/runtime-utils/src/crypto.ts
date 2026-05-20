/**
 * Ed25519 primitives — spec §32a.0 (runtime-utils).
 *
 * Lives in @nexus/runtime-utils so packages with restricted allow-lists
 * (Vanguard, connectors) can verify Ed25519 envelopes without reaching
 * into Core internals via relative paths. See AMEND-nexus-package-import-
 * law-resolver-v0-1-0.md §3 — Vanguard threat tests were previously
 * importing ../../core/src/crypto/* which is unlawful under layer law.
 */
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
function b64uDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

export async function signEd25519(payload: string, privateKeyB64Url: string): Promise<string> {
  const msg = new TextEncoder().encode(payload);
  const priv = b64uDecode(privateKeyB64Url);
  const sig = await ed25519.signAsync(msg, priv);
  return b64uEncode(sig);
}

export async function verifyEd25519(
  payload: string,
  signatureB64Url: string,
  publicKeyB64Url: string
): Promise<boolean> {
  try {
    const sig = b64uDecode(signatureB64Url);
    const msg = new TextEncoder().encode(payload);
    const pub = b64uDecode(publicKeyB64Url);
    return await ed25519.verifyAsync(sig, msg, pub);
  } catch {
    return false;
  }
}

export interface DevKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly generatedAt: string;
  readonly purpose: 'control_plane' | 'approver' | 'dev';
}

/**
 * Load the control-plane dev keypair. NEXUS_KEY_PATH overrides the default
 * `keys/dev.keypair.json` location. Intended for test/dev scenarios where a
 * package outside Core needs to verify or sign a payload against the
 * control-plane key (e.g., Vanguard threat tests).
 */
export async function loadDevKeypair(keyPath?: string): Promise<DevKeyPair> {
  const resolved =
    keyPath ?? process.env['NEXUS_KEY_PATH'] ?? path.join('keys', 'dev.keypair.json');
  const raw = await fs.readFile(resolved, 'utf-8');
  return JSON.parse(raw) as DevKeyPair;
}
