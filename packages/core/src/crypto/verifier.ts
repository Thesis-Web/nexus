/**
 * Ed25519 verifier — spec §15.3
 */
import * as ed25519 from '@noble/ed25519';
import type { Base64Url } from '../types/index.js';
import { base64urlDecode } from './signer.js';

export async function verify(
  payload: string,
  signature: Base64Url,
  publicKey: Base64Url
): Promise<boolean> {
  try {
    const sigBytes = base64urlDecode(signature);
    const msgBytes = new TextEncoder().encode(payload);
    const pubBytes = base64urlDecode(publicKey);
    return await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}
