/**
 * Threat test — Broad Token Bypass (spec §17.4)
 * CONTRA-601 RESOLVED: assertGrantPresent throws BROAD_TOKEN_BYPASS (spec §17.4)
 * CONTRA-602 RESOLVED: getGrantSecret returns undefined on unredeemed grant (spec §17.5)
 */
import { describe, it, expect } from 'vitest';
import {
  setGrantSecret,
  getGrantSecret,
  clearGrantSecret,
  assertGrantPresent,
  assertGrantNotExpired,
} from '../execution/grant-vault.js';
import { NexusSecurityViolation, DENIAL_CODE } from '../types/index.js';
import type { ExecutionGrant } from '../types/index.js';

function makeGrant(overrides?: Partial<ExecutionGrant>): ExecutionGrant {
  return {
    grantId: 'grant-test-001',
    actionId: 'action-001',
    templateId: 'template-001',
    approvalId: null,
    mintedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    capabilityId: 'read:record:single',
    scopeDescriptor: 'read:record:single@stub:record:single',
    credentialSubject: { subjectId: 'actor-001', subjectType: 'service_identity', system: 'stub' },
    resourceBounds: { maxRecords: 1, allowBulk: false, allowExternalFacing: false },
    environmentBound: 'dev',
    signature: 'sig',
    ...overrides,
  } as ExecutionGrant;
}

describe('Threat: Broad Token Bypass (spec §17.4)', () => {
  it('assertGrantPresent on unredeemed grant throws NexusSecurityViolation with BROAD_TOKEN_BYPASS (spec §17.4)', () => {
    const grant = makeGrant({ grantId: 'grant-bypass-001' });
    expect(() => assertGrantPresent(grant)).toThrow(NexusSecurityViolation);
    try {
      assertGrantPresent(grant);
    } catch (err) {
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.BROAD_TOKEN_BYPASS);
    }
  });

  it('assertGrantNotExpired on expired grant throws NexusSecurityViolation with GRANT_EXPIRED', () => {
    const grant = makeGrant({
      grantId: 'grant-expired-001',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    setGrantSecret(grant, 'FIXTURE_SYNTHETIC_SECRET:test');
    expect(() => assertGrantNotExpired(grant)).toThrow(NexusSecurityViolation);
    try {
      assertGrantNotExpired(grant);
    } catch (err) {
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.GRANT_EXPIRED);
    }
    clearGrantSecret(grant);
  });

  it('getGrantSecret returns undefined on unredeemed grant — does not throw (spec §17.5)', () => {
    const grant = makeGrant({ grantId: 'grant-unredeemed-001' });
    const secret = getGrantSecret(grant);
    expect(secret).toBeUndefined();
  });

  it('assertGrantPresent passes and does not throw after redeemGrant sets secret', () => {
    const grant = makeGrant({ grantId: 'grant-redeemed-001' });
    setGrantSecret(grant, 'FIXTURE_SYNTHETIC_SECRET:test-credential');
    expect(() => assertGrantPresent(grant)).not.toThrow();
    clearGrantSecret(grant);
  });
});
