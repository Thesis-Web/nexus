/**
 * Grant Vault Lifecycle — GRANT-SECRET-002
 *
 * Proves:
 *   1. clearGrantSecret removes tracking entry (no lingering strong reference)
 *   2. Expired grants are pruned on next setGrantSecret (lazy prune)
 *   3. Explicit pruneExpiredGrants() sweeps expired entries
 *   4. Abandoned grants (set but never cleared) are cleaned up by expiry prune
 *   5. Non-expired grants survive pruning
 *
 * Spec pins: §17 (grant vault), §17.4 (bypass detection), §17.5 (secret access)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setGrantSecret,
  getGrantSecret,
  clearGrantSecret,
  assertGrantPresent,
  pruneExpiredGrants,
  getActiveGrantCount,
} from '../execution/grant-vault.js';
import type { ExecutionGrant } from '../types/index.js';

function makeGrant(
  grantId: string,
  expiresInMs: number = 300_000,
): ExecutionGrant {
  return {
    grantId,
    actionId: `action-${grantId}`,
    templateId: `template-${grantId}`,
    approvalId: null,
    mintedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    capabilityId: 'read:record:single',
    scopeDescriptor: 'read:record:single@stub:record:single',
    credentialSubject: {
      subjectId: 'actor-001',
      subjectType: 'service_identity',
      system: 'stub',
    },
    resourceBounds: {
      maxRecords: 1,
      allowBulk: false,
      allowExternalFacing: false,
    },
    environmentBound: 'dev',
    signature: 'FIXTURE_SYNTHETIC_SECRET:sig',
  } as ExecutionGrant;
}

describe('Grant Vault Lifecycle — GRANT-SECRET-002', () => {
  beforeEach(() => {
    // Prune any stale entries from prior tests
    pruneExpiredGrants();
  });

  it('clearGrantSecret removes tracking entry — no lingering strong reference', () => {
    const grant = makeGrant('gs002-clear-001');
    const before = getActiveGrantCount();

    setGrantSecret(grant, 'FIXTURE_SYNTHETIC_SECRET:test');
    expect(getActiveGrantCount()).toBe(before + 1);

    clearGrantSecret(grant);
    expect(getActiveGrantCount()).toBe(before);
    expect(getGrantSecret(grant)).toBeUndefined();
  });

  it('expired grants are pruned on next setGrantSecret call (lazy prune)', () => {
    // Create a grant that expires immediately
    const expired = makeGrant('gs002-expired-001', -1000); // already expired
    // Bypass lazy prune by manipulating directly — set secret without triggering prune
    // We'll use the public API which does prune, but the grant itself is already expired
    // So we need to set a non-expired grant first, then let the expired one accumulate
    const alive = makeGrant('gs002-alive-001', 300_000);

    setGrantSecret(alive, 'FIXTURE_SYNTHETIC_SECRET:alive');
    const afterAlive = getActiveGrantCount();

    // Now set the expired grant — it will be added then immediately eligible for prune
    // But prune runs BEFORE the set, so it won't catch itself on this call.
    setGrantSecret(expired, 'FIXTURE_SYNTHETIC_SECRET:expired');
    expect(getActiveGrantCount()).toBe(afterAlive + 1);

    // Next setGrantSecret triggers lazy prune — expired grant should be swept
    const another = makeGrant('gs002-alive-002', 300_000);
    setGrantSecret(another, 'FIXTURE_SYNTHETIC_SECRET:another');

    // expired grant was pruned by the lazy prune in the setGrantSecret above
    expect(getGrantSecret(expired)).toBeUndefined();

    // Cleanup
    clearGrantSecret(alive);
    clearGrantSecret(another);
  });

  it('explicit pruneExpiredGrants() sweeps expired entries', () => {
    const expired1 = makeGrant('gs002-prune-001', -2000);
    const expired2 = makeGrant('gs002-prune-002', -1000);
    const alive = makeGrant('gs002-prune-alive', 300_000);

    setGrantSecret(alive, 'FIXTURE_SYNTHETIC_SECRET:alive');
    setGrantSecret(expired1, 'FIXTURE_SYNTHETIC_SECRET:exp1');
    setGrantSecret(expired2, 'FIXTURE_SYNTHETIC_SECRET:exp2');

    // Some expired entries may already be lazily pruned during setGrantSecret calls.
    // Explicit prune catches any remaining expired entries.
    const pruned = pruneExpiredGrants();
    expect(pruned).toBeGreaterThanOrEqual(1);

    // Outcome: BOTH expired secrets are gone (via lazy prune + explicit prune combined)
    expect(getGrantSecret(expired1)).toBeUndefined();
    expect(getGrantSecret(expired2)).toBeUndefined();

    // Alive grant survives both prune paths
    expect(getGrantSecret(alive)).toBe('FIXTURE_SYNTHETIC_SECRET:alive');

    clearGrantSecret(alive);
  });

  it('non-expired grants survive pruning', () => {
    const alive = makeGrant('gs002-survive-001', 300_000);
    setGrantSecret(alive, 'FIXTURE_SYNTHETIC_SECRET:survive');

    const pruned = pruneExpiredGrants();
    // alive grant should NOT be pruned
    expect(getGrantSecret(alive)).toBe('FIXTURE_SYNTHETIC_SECRET:survive');

    clearGrantSecret(alive);
  });

  it('complete grant lifecycle: set → assert → clear → verify gone', () => {
    const grant = makeGrant('gs002-lifecycle-001');
    const before = getActiveGrantCount();

    // Set
    setGrantSecret(grant, 'FIXTURE_SYNTHETIC_SECRET:lifecycle');
    expect(getActiveGrantCount()).toBe(before + 1);
    expect(getGrantSecret(grant)).toBe('FIXTURE_SYNTHETIC_SECRET:lifecycle');

    // Assert present (should not throw)
    expect(() => assertGrantPresent(grant)).not.toThrow();

    // Clear (mirrors Gate 06 finally block)
    clearGrantSecret(grant);

    // Verify gone — no lingering reference
    expect(getActiveGrantCount()).toBe(before);
    expect(getGrantSecret(grant)).toBeUndefined();
  });

  it('getActiveGrantCount returns 0 after all grants cleared', () => {
    const g1 = makeGrant('gs002-count-001');
    const g2 = makeGrant('gs002-count-002');
    const baseline = getActiveGrantCount();

    setGrantSecret(g1, 'FIXTURE_SYNTHETIC_SECRET:c1');
    setGrantSecret(g2, 'FIXTURE_SYNTHETIC_SECRET:c2');
    expect(getActiveGrantCount()).toBe(baseline + 2);

    clearGrantSecret(g1);
    clearGrantSecret(g2);
    expect(getActiveGrantCount()).toBe(baseline);
  });
});
