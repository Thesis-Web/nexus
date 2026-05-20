/**
 * ClaimVerifier — AMEND-nexus-claim-drift-verification-v0-1-0.md §2.1.
 *
 * Reference implementation of ClaimVerificationPort. Canonical comparison
 * uses the same JSON canonicalization the signing pipeline uses, hashed
 * via SHA-256. The verifier is constructed with a resolver function that
 * re-resolves current claims for a principalId; production wires this to
 * the IAM/RBAC plug-in, tests inject a stub.
 *
 * Layer: core (BAKED). NXS/NVG gates call into this port; failing to
 * call it is a CI gate violation (Spec F4.19 GOV-15).
 */
import type {
  ClaimVerificationPort,
  ClaimVerificationResult,
  ClaimsDiff,
  IsoTimestamp,
  NonEmpty,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';

export interface ClaimResolver {
  (principalId: Uuid): Promise<Record<string, unknown>>;
}

export class ReferenceClaimVerifier implements ClaimVerificationPort {
  constructor(private readonly resolver: ClaimResolver) {}

  async verify(
    carriedClaims: Record<string, unknown>,
    principalId: Uuid,
    _gateName: NonEmpty
  ): Promise<ClaimVerificationResult> {
    const carriedHash = sha256(canonicalize(carriedClaims)) as Sha256Hex;
    const current = await this.resolver(principalId);
    const currentHash = sha256(canonicalize(current)) as Sha256Hex;
    if (carriedHash === currentHash) {
      return { kind: 'match', currentClaimsHash: currentHash };
    }
    const fieldsChanged = diffTopLevelFields(carriedClaims, current);
    const diff: ClaimsDiff = {
      principalId,
      fieldsChanged,
      carriedHash,
      currentHash,
      detectedAt: new Date().toISOString() as IsoTimestamp,
    };
    return { kind: 'drift', currentClaimsHash: currentHash, diff };
  }
}

function diffTopLevelFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): ReadonlyArray<string> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (canonicalize(a[key]) !== canonicalize(b[key])) changed.push(key);
  }
  return changed;
}
