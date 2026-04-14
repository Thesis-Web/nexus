/**
 * Ed25519 signer — spec §15.3
 * Algorithm: Ed25519. Library: @noble/ed25519.
 * All callers pass canonicalize(obj) as payload. Never raw JSON.stringify.
 */
import * as ed25519 from '@noble/ed25519';
import { createHash } from 'crypto';
// @noble/ed25519 v2 requires a SHA-512 implementation to be set
import { sha512 } from '@noble/hashes/sha512';
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));
function base64urlEncode(bytes) {
    return Buffer.from(bytes).toString('base64url');
}
function base64urlDecode(s) {
    return Buffer.from(s, 'base64url');
}
export async function sign(payload, keyPair) {
    const msgBytes = new TextEncoder().encode(payload);
    const privBytes = base64urlDecode(keyPair.privateKey);
    const sig = await ed25519.signAsync(msgBytes, privBytes);
    return base64urlEncode(sig);
}
export function sha256(payload) {
    return createHash('sha256').update(new TextEncoder().encode(payload)).digest('hex');
}
export { base64urlEncode, base64urlDecode };
