/**
 * Policy rule loader — spec §12.3
 * Signature verification on load. Invalid signature → throw PolicySignatureError.
 */
import { promises as fs } from 'fs';
import { PolicySignatureError } from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { sha256 } from '../crypto/signer.js';
export function computePolicyBundleHash(policyFile) {
    const { signature: _, ...rest } = policyFile;
    return sha256(canonicalize(rest));
}
export async function loadPolicyFile(filepath, controlPlaneKey) {
    const raw = await fs.readFile(filepath, 'utf-8');
    const parsed = JSON.parse(raw);
    const { signature, ...body } = parsed;
    const isValid = await verify(canonicalize(body), signature, controlPlaneKey.publicKey);
    if (!isValid) {
        throw new PolicySignatureError(`Policy file ${filepath} signature invalid — rejected`);
    }
    return {
        ...parsed,
        sortedRules: [...parsed.rules].sort((a, b) => a.priority - b.priority),
        bundleHash: computePolicyBundleHash(parsed),
    };
}
