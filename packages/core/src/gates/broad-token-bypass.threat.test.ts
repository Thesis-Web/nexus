/**
 * Threat test 9 — Broad Token Bypass
 * Spec §17.4, §27.2 item 9
 *
 * CONTRA-601: Built assertGrantPresent(grant: ExecutionGrant) checks for absent
 * WeakMap secret (not null/undefined grant) and throws GRANT_EXPIRED (not BROAD_TOKEN_BYPASS
 * as spec §17.4 prescribes). Tests reflect actual implementation. Owner must approve
 * before BROAD_TOKEN_BYPASS is canonized as the correct denial code here.
 *
 * The security property is preserved: calling execute() on an unredeemed grant
 * (no redeemGrant called) throws NexusSecurityViolation — execution is blocked.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  assertGrantPresent,
  assertGrantNotExpired,
  getGrantSecret,
} from '../execution/grant-vault.js';
import { NexusSecurityViolation, DENIAL_CODE } from '../types/index.js';
import { nowIso, addSeconds } from '../utils/time.js';
import type { ExecutionGrant } from '../types/index.js';

function makeGrant(expiresOffset = 30): ExecutionGrant {
  return {
    grantId: randomUUID(),
    actionId: randomUUID(),
    templateId: randomUUID(),
    mintedAt: nowIso(),
    expiresAt: addSeconds(nowIso(), expiresOffset),
    scopeDescriptor: 'read:record:single@vault:secret:single',
    credentialSubject: {
      subjectId: 'svc:test-agent',
      subjectType: 'service_identity',
      system: 'vault',
    },
    approvalId: null,
    mintedBy: 'nexus-grant-minter@v0.1.0',
  } as unknown as ExecutionGrant;
}

describe('Threat: Broad Token Bypass (spec §17.4)', () => {
  it('assertGrantPresent on unredeemed grant throws NexusSecurityViolation (CONTRA-601: denialCode is GRANT_EXPIRED in implementation)', () => {
    const grant = makeGrant(); // redeemGrant never called — no secret set
    expect(() => assertGrantPresent(grant)).toThrow(NexusSecurityViolation);
  });

  it('assertGrantNotExpired on expired grant throws NexusSecurityViolation with GRANT_EXPIRED', () => {
    const expiredGrant = makeGrant(-60); // expired 60 seconds ago
    expect(() => assertGrantNotExpired(expiredGrant)).toThrow(NexusSecurityViolation);

    try {
      assertGrantNotExpired(expiredGrant);
    } catch (err) {
      expect(err).toBeInstanceOf(NexusSecurityViolation);
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.GRANT_EXPIRED);
    }
  });

  it('CONTRA-602: getGrantSecret throws on unredeemed grant — spec §17.5 expects return undefined', () => {
    // Spec §17.5: getGrantSecret returns string | undefined — no throw.
    // Implementation throws NexusSecurityViolation(GRANT_EXPIRED) instead.
    // CONTRA-602 logged — owner approval required.
    const grant = makeGrant();
    expect(() => getGrantSecret(grant)).toThrow(NexusSecurityViolation);
  });

  it('assertGrantPresent blocks execution on any grant without a set secret', () => {
    const grant1 = makeGrant();
    const grant2 = makeGrant();
    // Neither has had redeemGrant called
    expect(() => assertGrantPresent(grant1)).toThrow(NexusSecurityViolation);
    expect(() => assertGrantPresent(grant2)).toThrow(NexusSecurityViolation);
  });
});
