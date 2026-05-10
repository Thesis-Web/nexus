/**
 * Unit tests for the policy condition matcher. Each filter is tested
 * independently. The targetSystems filter — the new field added so
 * marketplace-style per-connector policy bundles can scope their rules
 * — gets dedicated coverage including back-compat (rules without
 * targetSystems still match any target).
 */
import { describe, it, expect } from 'vitest';
import { matchesCondition, type PolicyEvalEnvelope } from './evaluator.js';
import type { PolicyCondition } from '../types/index.js';

const baseEnv: PolicyEvalEnvelope = {
  actorClass: 'SUPERVISED_AGENT',
  capability: 'read:record:bulk',
  verb: 'read',
  riskTier: 'low',
  dataClasses: ['public'],
  environment: 'reference',
  externalFacing: false,
  chainDepth: 1,
  targetSystem: 'warehouse',
};

describe('matchesCondition — empty conditions', () => {
  it('returns true for an empty condition (matches anything)', () => {
    expect(matchesCondition({}, baseEnv)).toBe(true);
  });
});

describe('matchesCondition — actorClasses', () => {
  it('matches when class is in list', () => {
    expect(matchesCondition({ actorClasses: ['SUPERVISED_AGENT'] }, baseEnv)).toBe(true);
  });
  it('rejects when class is not in list', () => {
    expect(matchesCondition({ actorClasses: ['HUMAN'] }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — capabilities', () => {
  it('matches on exact capability ID', () => {
    expect(matchesCondition({ capabilities: ['read:record:bulk'] }, baseEnv)).toBe(true);
  });
  it('rejects on different capability', () => {
    expect(matchesCondition({ capabilities: ['read:record:single'] }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — riskTiers', () => {
  it('matches when riskTier is in list', () => {
    expect(matchesCondition({ riskTiers: ['low', 'medium'] }, baseEnv)).toBe(true);
  });
  it('rejects when riskTier is not in list', () => {
    expect(matchesCondition({ riskTiers: ['high'] }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — environments', () => {
  it('matches when environment is in list', () => {
    expect(matchesCondition({ environments: ['reference', 'dev'] }, baseEnv)).toBe(true);
  });
  it('rejects when environment is not in list', () => {
    expect(matchesCondition({ environments: ['prod'] }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — targetSystems', () => {
  it('matches when targetSystem is in list', () => {
    expect(matchesCondition({ targetSystems: ['warehouse'] }, baseEnv)).toBe(true);
  });
  it('matches when targetSystem is one of several', () => {
    expect(matchesCondition({ targetSystems: ['sales-finance', 'warehouse'] }, baseEnv)).toBe(true);
  });
  it('rejects when targetSystem is not in list', () => {
    expect(matchesCondition({ targetSystems: ['sales-finance'] }, baseEnv)).toBe(false);
  });
  it('back-compat: rule WITHOUT targetSystems matches any target', () => {
    // This is the load-bearing back-compat invariant: pre-existing
    // policy bundles that don't use the new field keep working
    // identically. Marketplace bundles opt into per-target scoping;
    // operators don't have to retrofit existing rules.
    expect(matchesCondition({ capabilities: ['read:record:bulk'] }, baseEnv)).toBe(true);
    const otherTargetEnv = { ...baseEnv, targetSystem: 'unrelated-system' };
    expect(matchesCondition({ capabilities: ['read:record:bulk'] }, otherTargetEnv)).toBe(true);
  });
});

describe('matchesCondition — externalFacing', () => {
  it('matches when externalFacing flag matches', () => {
    expect(matchesCondition({ externalFacing: false }, baseEnv)).toBe(true);
  });
  it('rejects when externalFacing flag mismatches', () => {
    expect(matchesCondition({ externalFacing: true }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — maxChainDepth', () => {
  it('matches when chainDepth is at or under cap', () => {
    expect(matchesCondition({ maxChainDepth: 1 }, baseEnv)).toBe(true);
    expect(matchesCondition({ maxChainDepth: 5 }, baseEnv)).toBe(true);
  });
  it('rejects when chainDepth exceeds cap', () => {
    expect(matchesCondition({ maxChainDepth: 0 }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — multi-field AND semantics', () => {
  it('all listed conditions must match', () => {
    const cond: PolicyCondition = {
      actorClasses: ['SUPERVISED_AGENT'],
      capabilities: ['read:record:bulk'],
      riskTiers: ['low'],
      environments: ['reference'],
      targetSystems: ['warehouse'],
    };
    expect(matchesCondition(cond, baseEnv)).toBe(true);
  });
  it('one mismatching field fails the whole condition', () => {
    const cond: PolicyCondition = {
      actorClasses: ['SUPERVISED_AGENT'],
      capabilities: ['read:record:bulk'],
      riskTiers: ['low'],
      environments: ['reference'],
      targetSystems: ['sales-finance'], // mismatched — env target is warehouse
    };
    expect(matchesCondition(cond, baseEnv)).toBe(false);
  });
});
