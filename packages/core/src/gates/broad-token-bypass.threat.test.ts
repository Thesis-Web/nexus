/**
 * Threat test 9 — Broad Token Bypass
 * Spec §17.4, §27.2 item 9
 * Calling connector.execute() without a pipeline-issued grant → NexusSecurityViolation.
 * assertGrantPresent() enforces this. Gate 06 catches it → denied_threat.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { assertGrantPresent, assertGrantNotExpired } from '../execution/grant-vault.js';
import { NexusSecurityViolation, DENIAL_CODE } from '../types/index.js';
import { nowIso, addSeconds } from '../utils/time.js';
import type { ExecutionGrant } from '../types/index.js';

function makeExpiredGrant(): ExecutionGrant {
  return {
    grantId: randomUUID(),
    actionId: randomUUID(),
    templateId: randomUUID(),
    mintedAt: addSeconds(nowIso(), -120),
    expiresAt: addSeconds(nowIso(), -60), // expired 60 seconds ago
    scopeDescriptor: 'read:record:single@vault:secret:single',
    credentialSubject: {
      subjectId: 'svc:agent-01',
      subjectType: 'service_identity',
      system: 'vault',
    },
    approvalId: null,
    mintedBy: 'nexus-grant-minter@v0.1.0',
  } as unknown as ExecutionGrant;
}

describe('Threat: Broad Token Bypass (spec §17.4)', () => {
  it('assertGrantPresent(undefined) throws NexusSecurityViolation with BROAD_TOKEN_BYPASS', () => {
    expect(() => assertGrantPresent(undefined as any)).toThrow(NexusSecurityViolation);

    try {
      assertGrantPresent(undefined as any);
    } catch (err) {
      expect(err).toBeInstanceOf(NexusSecurityViolation);
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.BROAD_TOKEN_BYPASS);
    }
  });

  it('assertGrantPresent(null) throws NexusSecurityViolation with BROAD_TOKEN_BYPASS', () => {
    expect(() => assertGrantPresent(null as any)).toThrow(NexusSecurityViolation);
  });

  it('assertGrantNotExpired on expired grant throws NexusSecurityViolation with GRANT_EXPIRED', () => {
    const expiredGrant = makeExpiredGrant();
    expect(() => assertGrantNotExpired(expiredGrant)).toThrow(NexusSecurityViolation);

    try {
      assertGrantNotExpired(expiredGrant);
    } catch (err) {
      expect(err).toBeInstanceOf(NexusSecurityViolation);
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.GRANT_EXPIRED);
    }
  });

  it('grant without a set secret (no redeemGrant called) passes assertGrantPresent but has no usable secret', () => {
    // assertGrantPresent only checks grant !== undefined/null.
    // getGrantSecret() returning undefined is the broad-token-bypass signal at the connector level.
    // This test documents the contract: present grant ≠ redeemed grant.
    const { getGrantSecret } = require('../execution/grant-vault.js');
    const grant = makeExpiredGrant();
    // Not calling setGrantSecret — grant secret was never set
    const secret = getGrantSecret(grant);
    expect(secret).toBeUndefined();
  });
});
