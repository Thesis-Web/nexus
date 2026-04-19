/**
 * Policy rule loader — spec §12.3
 * Signature verification on load. Invalid signature → throw PolicySignatureError.
 */
import { promises as fs } from 'fs';
import { PolicySignatureError, type PolicyFile, type LoadedPolicyFile } from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { sha256 } from '../crypto/signer.js';
import type { KeyPair } from '../crypto/key-manager.js';

export function computePolicyBundleHash(policyFile: PolicyFile): string {
  const { signature: _, ...rest } = policyFile;
  return sha256(canonicalize(rest));
}

export async function loadPolicyFile(
  filepath: string,
  controlPlaneKey: KeyPair
): Promise<LoadedPolicyFile> {
  const raw = await fs.readFile(filepath, 'utf-8');
  const parsed = JSON.parse(raw) as PolicyFile;

  const { signature, ...body } = parsed;
  const isValid = await verify(canonicalize(body), signature, controlPlaneKey.publicKey);

  if (!isValid) {
    throw new PolicySignatureError(`Policy file ${filepath} signature invalid — rejected`);
  }

  return {
    ...parsed,
    filepath,
    loadedAt: new Date().toISOString(),
    sortedRules: [...parsed.rules].sort((a, b) => a.priority - b.priority),
    bundleHash: computePolicyBundleHash(parsed),
  };
}
