/**
 * Policy rule loader — spec §12.3 + F4.2 §2.3 structural validation.
 *
 * Two-stage validation on load:
 *   1. Signature verification — invalid → throw `PolicySignatureError`.
 *   2. Structural validation — every rule's `conditions.octLevels`
 *      MUST be a non-empty(*) array (F4.2 §2.3 makes the field
 *      required; the evaluator at `policy/evaluator.ts:55` unconditionally
 *      calls `cond.octLevels.includes(...)`, so a missing field crashes
 *      at eval time with `Cannot read properties of undefined (reading
 *      'includes')` AFTER Gates 01-03 have already passed — producing a
 *      misleading `error_dispatch` finalOutcome). Reject here so drift
 *      fails at boot, not at first-run.
 *
 *      (*) An empty `octLevels: []` array is permitted by the spec
 *      ("means no actor matches; default-secure") and IS NOT rejected
 *      here — that's a deliberate authoring choice. Only the missing /
 *      non-array case fails closed.
 */
import { promises as fs } from 'fs';
import {
  PolicySignatureError,
  PolicyRuleValidationError,
  type PolicyFile,
  type LoadedPolicyFile,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { sha256 } from '../crypto/signer.js';
import type { KeyPair } from '../crypto/key-manager.js';

export function computePolicyBundleHash(policyFile: PolicyFile): string {
  const { signature: _, ...rest } = policyFile;
  return sha256(canonicalize(rest));
}

/**
 * F4.2 §2.3 structural-validation pass — every rule's `conditions.octLevels`
 * must be present and be an array. The evaluator depends on this invariant;
 * we enforce it at load time so the dispatch pipeline can rely on it.
 */
function validatePolicyRuleStructure(parsed: PolicyFile, filepath: string): void {
  for (const rule of parsed.rules) {
    const cond = rule.conditions as unknown as Record<string, unknown> | undefined;
    if (cond === undefined || cond === null) {
      throw new PolicyRuleValidationError(
        `Policy file ${filepath}: rule '${rule.ruleId}' has no 'conditions' object — required by spec §13.5.`
      );
    }
    if (!('octLevels' in cond)) {
      throw new PolicyRuleValidationError(
        `Policy file ${filepath}: rule '${rule.ruleId}' is missing required field 'conditions.octLevels' ` +
          `(F4.2 §2.3 — every rule must declare the OCT axis explicitly; the empty array '[]' is allowed ` +
          `and means default-secure / no-actor-matches).`
      );
    }
    if (!Array.isArray(cond['octLevels'])) {
      throw new PolicyRuleValidationError(
        `Policy file ${filepath}: rule '${rule.ruleId}' field 'conditions.octLevels' is not an array ` +
          `(got ${typeof cond['octLevels']}).`
      );
    }
  }
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

  // F4.2 §2.3 — fail closed at load if any rule lacks the OCT axis.
  // Stops the eval-time `cond.octLevels.includes(...)` TypeError that
  // surfaces as `error_dispatch` after Gates 01-03 have already passed.
  validatePolicyRuleStructure(parsed, filepath);

  return {
    ...parsed,
    filepath,
    loadedAt: new Date().toISOString(),
    sortedRules: [...parsed.rules].sort((a, b) => a.priority - b.priority),
    bundleHash: computePolicyBundleHash(parsed),
  };
}
