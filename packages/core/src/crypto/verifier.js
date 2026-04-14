/**
 * Ed25519 verifier — spec §15.3
 */
import * as ed25519 from '@noble/ed25519';
import { base64urlDecode } from './signer.js';
export async function verify(payload, signature, publicKey) {
    try {
        const sigBytes = base64urlDecode(signature);
        const msgBytes = new TextEncoder().encode(payload);
        const pubBytes = base64urlDecode(publicKey);
        return await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
    }
    catch {
        return false;
    }
}
