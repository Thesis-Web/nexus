/**
 * Unit tests for the policy condition matcher. Each filter is tested
 * independently. The targetSystems filter — the new field added so
 * marketplace-style per-connector policy bundles can scope their rules
 * — gets dedicated coverage including back-compat (rules without
 * targetSystems still match any target).
 *
 * F4.2 — every condition carries an `octLevels` list now (the field is
 * mandatory). The matcher applies the OCT check unconditionally; rules
 * with an empty `octLevels` reject every actor (default-secure). POL-OCT-03
 * exercises the "same action/system + different OCT → different rule
 * matches" axis the spec calls out.
 */
import { describe, it, expect } from 'vitest';
import { matchesCondition, type PolicyEvalEnvelope } from './evaluator.js';
import type { OctLevel, PolicyCondition } from '../types/index.js';
import { OCT_LEVEL, ALL_PRINCIPAL_OCT_LEVELS } from '../types/index.js';

const ALL_OCT: readonly OctLevel[] = ALL_PRINCIPAL_OCT_LEVELS;

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
  octLevel: OCT_LEVEL.OPEN as OctLevel,
};

describe('matchesCondition — empty conditions (apart from required octLevels)', () => {
  it('matches anything when the only filter is the OCT axis covering env.octLevel', () => {
    expect(matchesCondition({ octLevels: ALL_OCT }, baseEnv)).toBe(true);
  });
  it('rejects when octLevels is the empty list (default-secure)', () => {
    expect(matchesCondition({ octLevels: [] }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — actorClasses', () => {
  it('matches when class is in list', () => {
    expect(
      matchesCondition({ actorClasses: ['SUPERVISED_AGENT'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(true);
  });
  it('rejects when class is not in list', () => {
    expect(matchesCondition({ actorClasses: ['HUMAN'], octLevels: ALL_OCT }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — capabilities', () => {
  it('matches on exact capability ID', () => {
    expect(
      matchesCondition({ capabilities: ['read:record:bulk'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(true);
  });
  it('rejects on different capability', () => {
    expect(
      matchesCondition({ capabilities: ['read:record:single'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(false);
  });
});

describe('matchesCondition — riskTiers', () => {
  it('matches when riskTier is in list', () => {
    expect(matchesCondition({ riskTiers: ['low', 'medium'], octLevels: ALL_OCT }, baseEnv)).toBe(
      true
    );
  });
  it('rejects when riskTier is not in list', () => {
    expect(matchesCondition({ riskTiers: ['high'], octLevels: ALL_OCT }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — environments', () => {
  it('matches when environment is in list', () => {
    expect(
      matchesCondition({ environments: ['reference', 'dev'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(true);
  });
  it('rejects when environment is not in list', () => {
    expect(matchesCondition({ environments: ['prod'], octLevels: ALL_OCT }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — targetSystems', () => {
  it('matches when targetSystem is in list', () => {
    expect(matchesCondition({ targetSystems: ['warehouse'], octLevels: ALL_OCT }, baseEnv)).toBe(
      true
    );
  });
  it('matches when targetSystem is one of several', () => {
    expect(
      matchesCondition(
        { targetSystems: ['sales-finance', 'warehouse'], octLevels: ALL_OCT },
        baseEnv
      )
    ).toBe(true);
  });
  it('rejects when targetSystem is not in list', () => {
    expect(
      matchesCondition({ targetSystems: ['sales-finance'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(false);
  });
  it('back-compat: rule WITHOUT targetSystems matches any target', () => {
    // This is the load-bearing back-compat invariant: pre-existing
    // policy bundles that don't use the targetSystems field keep working
    // identically. Marketplace bundles opt into per-target scoping;
    // operators don't have to retrofit existing rules. (octLevels is
    // a separate, mandatory axis as of F4.2.)
    expect(
      matchesCondition({ capabilities: ['read:record:bulk'], octLevels: ALL_OCT }, baseEnv)
    ).toBe(true);
    const otherTargetEnv = { ...baseEnv, targetSystem: 'unrelated-system' };
    expect(
      matchesCondition({ capabilities: ['read:record:bulk'], octLevels: ALL_OCT }, otherTargetEnv)
    ).toBe(true);
  });
});

describe('matchesCondition — externalFacing', () => {
  it('matches when externalFacing flag matches', () => {
    expect(matchesCondition({ externalFacing: false, octLevels: ALL_OCT }, baseEnv)).toBe(true);
  });
  it('rejects when externalFacing flag mismatches', () => {
    expect(matchesCondition({ externalFacing: true, octLevels: ALL_OCT }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — maxChainDepth', () => {
  it('matches when chainDepth is at or under cap', () => {
    expect(matchesCondition({ maxChainDepth: 1, octLevels: ALL_OCT }, baseEnv)).toBe(true);
    expect(matchesCondition({ maxChainDepth: 5, octLevels: ALL_OCT }, baseEnv)).toBe(true);
  });
  it('rejects when chainDepth exceeds cap', () => {
    expect(matchesCondition({ maxChainDepth: 0, octLevels: ALL_OCT }, baseEnv)).toBe(false);
  });
});

describe('matchesCondition — octLevels (F4.2)', () => {
  it('rejects when env.octLevel is not in the rule list', () => {
    expect(
      matchesCondition(
        { octLevels: [OCT_LEVEL.SECURE as OctLevel] },
        { ...baseEnv, octLevel: OCT_LEVEL.OPEN as OctLevel }
      )
    ).toBe(false);
  });
  it('matches when env.octLevel is in the rule list', () => {
    expect(
      matchesCondition(
        { octLevels: [OCT_LEVEL.OPEN as OctLevel, OCT_LEVEL.CONFIDENTIAL as OctLevel] },
        { ...baseEnv, octLevel: OCT_LEVEL.OPEN as OctLevel }
      )
    ).toBe(true);
  });

  it('POL-OCT-03: same action/system resolves differently for OCT_OPEN vs OCT_SECURE', () => {
    // Two rules differ ONLY by octLevels; matching them depends entirely
    // on the actor's OCT classification. This is the property the spec
    // calls out as the V1 motivation: the same prompt resolves
    // differently depending on classification.
    const allowOpen: PolicyCondition = {
      capabilities: ['read:record:bulk'],
      targetSystems: ['warehouse'],
      octLevels: [OCT_LEVEL.OPEN as OctLevel],
    };
    const allowSecure: PolicyCondition = {
      capabilities: ['read:record:bulk'],
      targetSystems: ['warehouse'],
      octLevels: [OCT_LEVEL.SECURE as OctLevel],
    };
    const openActor = { ...baseEnv, octLevel: OCT_LEVEL.OPEN as OctLevel };
    const secureActor = { ...baseEnv, octLevel: OCT_LEVEL.SECURE as OctLevel };

    expect(matchesCondition(allowOpen, openActor)).toBe(true);
    expect(matchesCondition(allowOpen, secureActor)).toBe(false);
    expect(matchesCondition(allowSecure, openActor)).toBe(false);
    expect(matchesCondition(allowSecure, secureActor)).toBe(true);
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
      octLevels: ALL_OCT,
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
      octLevels: ALL_OCT,
    };
    expect(matchesCondition(cond, baseEnv)).toBe(false);
  });
});
