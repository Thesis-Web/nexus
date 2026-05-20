/**
 * Unit tests for ReferenceClaimVerifier — F4.9 CDV-01 through CDV-03.
 */
import { describe, it, expect } from 'vitest';
import type { Uuid } from '@nexus/contracts';
import { ReferenceClaimVerifier } from './claim-verifier.js';

const principalId = '11111111-1111-1111-1111-111111111111' as Uuid;
const gateName = 'gate_02_classification' as never;

describe('ReferenceClaimVerifier (F4.9)', () => {
  it('CDV-01: identical carried/current → match', async () => {
    const carried = { capabilities: ['read'], octLevel: 'OCT-OPEN' };
    const verifier = new ReferenceClaimVerifier(async () => ({
      capabilities: ['read'],
      octLevel: 'OCT-OPEN',
    }));
    const result = await verifier.verify(carried, principalId, gateName);
    expect(result.kind).toBe('match');
  });

  it('CDV-02: capability removed → drift with fieldsChanged=["capabilities"]', async () => {
    const carried = { capabilities: ['read', 'write'], octLevel: 'OCT-OPEN' };
    const verifier = new ReferenceClaimVerifier(async () => ({
      capabilities: ['read'],
      octLevel: 'OCT-OPEN',
    }));
    const result = await verifier.verify(carried, principalId, gateName);
    expect(result.kind).toBe('drift');
    if (result.kind === 'drift') {
      expect(result.diff.fieldsChanged).toEqual(['capabilities']);
      expect(result.diff.principalId).toBe(principalId);
      expect(result.diff.carriedHash).not.toBe(result.diff.currentHash);
    }
  });

  it('CDV-03: OCT raised → drift with fieldsChanged=["octLevel"]', async () => {
    const carried = { capabilities: ['read'], octLevel: 'OCT-OPEN' };
    const verifier = new ReferenceClaimVerifier(async () => ({
      capabilities: ['read'],
      octLevel: 'OCT-SECURE',
    }));
    const result = await verifier.verify(carried, principalId, gateName);
    expect(result.kind).toBe('drift');
    if (result.kind === 'drift') {
      expect(result.diff.fieldsChanged).toEqual(['octLevel']);
    }
  });

  it('canonicalization is stable across key order', async () => {
    const carried = { a: 1, b: 2 };
    const verifier = new ReferenceClaimVerifier(async () => ({ b: 2, a: 1 }));
    const result = await verifier.verify(carried, principalId, gateName);
    expect(result.kind).toBe('match');
  });
});
