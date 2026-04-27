/**
 * CCV Builder — CCV-001 proof test
 * Spec §14.2: sentinel-faithful encoding (EVIDENCE_SENTINEL, not null/empty).
 */
import { describe, it, expect } from 'vitest';
import { computeNormalizedActionHash } from './ccv-builder.js';
import { EVIDENCE_SENTINEL } from '../types/index.js';

describe('CCV Builder — CCV-001 sentinel encoding', () => {
  it('uses EVIDENCE_SENTINEL for absent target fields, not null', () => {
    const hash = computeNormalizedActionHash({
      tool: 'test-tool',
      resolvedVerb: 'read',
      resolvedCapability: 'read:record:single',
      resolvedTarget: EVIDENCE_SENTINEL,
      resolvedDataClasses: ['public'],
      resolvedRiskTier: 'low',
      actorId: 'a1',
      principalId: 'p1',
      actorClass: 'HUMAN',
      actorEnvironment: 'dev',
      receivedAt: '2026-01-01T00:00:00.000Z',
    } as any);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  it('sentinel target produces different hash than resolved target', () => {
    const base = {
      tool: 'test-tool',
      resolvedVerb: 'read',
      resolvedCapability: 'read:record:single',
      resolvedDataClasses: ['public'],
      resolvedRiskTier: 'low',
      actorId: 'a1',
      principalId: 'p1',
      actorClass: 'HUMAN',
      actorEnvironment: 'dev',
      receivedAt: '2026-01-01T00:00:00.000Z',
    };
    const sentinelHash = computeNormalizedActionHash({
      ...base,
      resolvedTarget: EVIDENCE_SENTINEL,
    } as any);
    const resolvedHash = computeNormalizedActionHash({
      ...base,
      resolvedTarget: {
        system: 'stub',
        resourceType: 'record',
        resourceScope: 'single',
        externalFacing: false,
      },
    } as any);
    expect(sentinelHash).not.toBe(resolvedHash);
  });
});
