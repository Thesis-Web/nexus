/**
 * Unit tests — BakedDelegationMint.
 *
 * F4.15 acceptance gates:
 *   DMF-01 — success returns SignedDelegation with effectiveScope =
 *            three-way intersection.
 *   DMF-02 — user read+write ∩ agent read ∩ explicit read →
 *            effectiveScope.capabilities = ['read'].
 *   DMF-03 — user read inventory ∩ agent write sales →
 *            empty_intersection { dimension: 'capabilities' };
 *            no SignedDelegation.
 *   DMF-04 — signing unavailable → mint_error { reason:
 *            'signing_unavailable' }; no fabricated UUID.
 *   DMF-05 — OCT intersection lesser-wins: user OCT-OPEN, agent
 *            max OCT-CONFIDENTIAL → effectiveScope.octLevel = OCT-OPEN.
 *
 * Pure helpers also exercised:
 *   intersectStrings, lesserOct, lesserRisk.
 */
import { describe, it, expect } from 'vitest';
import type {
  AgentDeclaration,
  DelegationContext,
  DelegationMintInput,
  ExplicitDelegationScope,
  IdentityClaimsCapabilityCeiling,
  IsoTimestamp,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { OCT_LEVEL, RISK_TIER } from '@nexus/contracts';
import {
  BakedDelegationMint,
  intersectStrings,
  lesserOct,
  lesserRisk,
  type DelegationSigner,
} from './delegation-mint.js';

const USER_ID = '00000000-0000-0000-0000-000000000001' as Uuid;
const AGENT_ID = '00000000-0000-0000-0000-000000000002' as Uuid;
const RUN_ID = '00000000-0000-0000-0000-000000000003' as Uuid;
const ISSUED_AT = '2026-05-20T00:00:00.000Z' as IsoTimestamp;
const EXPIRES_AT = '2026-05-20T01:00:00.000Z' as IsoTimestamp;

function makeUserClaims(
  overrides: Partial<IdentityClaimsCapabilityCeiling> = {}
): IdentityClaimsCapabilityCeiling {
  return {
    principalId: USER_ID,
    permittedTargetSystems: ['sales-db' as NonEmpty, 'inventory-db' as NonEmpty],
    permittedCapabilities: ['read', 'write'],
    firewallTransitRights: {
      outbound: ['public-api' as NonEmpty],
      inbound: ['payload-blob' as NonEmpty],
    },
    permittedRunTypes: ['chat', 'sectioned'],
    octLevel: OCT_LEVEL.CONFIDENTIAL,
    maxRiskTier: RISK_TIER.MEDIUM,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentDeclaration> = {}): AgentDeclaration {
  return {
    agentId: AGENT_ID,
    visibleTargetSystems: ['sales-db' as NonEmpty, 'inventory-db' as NonEmpty],
    allowedCapabilities: ['read', 'write'],
    firewallTransitRights: {
      outbound: ['public-api' as NonEmpty],
      inbound: ['payload-blob' as NonEmpty],
    },
    permittedRunTypes: ['chat', 'sectioned', 'autonomous'],
    maxOctLevel: OCT_LEVEL.CONFIDENTIAL,
    maxRiskTier: RISK_TIER.MEDIUM,
    ...overrides,
  };
}

function makeExplicit(overrides: Partial<ExplicitDelegationScope> = {}): ExplicitDelegationScope {
  return {
    targetSystems: ['sales-db' as NonEmpty],
    capabilities: ['read'],
    firewallTransitRights: { outbound: ['public-api' as NonEmpty], inbound: [] },
    runTypes: ['chat'],
    maxOctLevel: OCT_LEVEL.CONFIDENTIAL,
    maxRiskTier: RISK_TIER.MEDIUM,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function makeInput(overrides: Partial<DelegationMintInput> = {}): DelegationMintInput {
  return {
    runId: RUN_ID,
    nodeId: 'node-1' as NonEmpty,
    userClaims: makeUserClaims(),
    agentDeclaration: makeAgent(),
    explicitDelegatedScope: makeExplicit(),
    issuedAt: ISSUED_AT,
    maxChainDepth: 2,
    ...overrides,
  };
}

/** Deterministic signer for tests — fills in delegationId + signature. */
const fixedSigner: DelegationSigner = async body => ({
  ...body,
  delegationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as Uuid,
  signature: 'sig:test' as DelegationContext['signature'],
  environment: 'dev' as DelegationContext['environment'],
  mintedBy: 'test-engine' as NonEmpty,
});

const fixedErrorRef = () => 'err-ref-test' as NonEmpty;

// ─── Pure-helper tests ──────────────────────────────────────────────────────

describe('intersectStrings — three-way intersection helper', () => {
  it('returns items that appear in all three sources, ordered by source A', () => {
    expect(intersectStrings(['a', 'b', 'c'], ['c', 'a'], ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('returns empty when any source is empty', () => {
    expect(intersectStrings([], ['a'], ['a'])).toEqual([]);
    expect(intersectStrings(['a'], [], ['a'])).toEqual([]);
    expect(intersectStrings(['a'], ['a'], [])).toEqual([]);
  });

  it('returns empty when no item is in all three', () => {
    expect(intersectStrings(['a', 'b'], ['b', 'c'], ['c', 'd'])).toEqual([]);
  });
});

describe('lesserOct — OCT level lesser-wins helper', () => {
  it('picks OCT-OPEN when one candidate is OCT-OPEN', () => {
    expect(lesserOct([OCT_LEVEL.OPEN, OCT_LEVEL.CONFIDENTIAL, OCT_LEVEL.SECURE])).toBe(
      OCT_LEVEL.OPEN
    );
  });

  it('picks OCT-CONFIDENTIAL when min is OCT-CONFIDENTIAL', () => {
    expect(lesserOct([OCT_LEVEL.CONFIDENTIAL, OCT_LEVEL.SECURE, OCT_LEVEL.SECURE])).toBe(
      OCT_LEVEL.CONFIDENTIAL
    );
  });

  it('returns null when an OCT level is not in the rank table (e.g., OCT-COMPILE)', () => {
    // OCT-COMPILE is intentionally outside the linear ranking per
    // packages/contracts constants/index.ts comment on OCT_RANK.
    expect(lesserOct([OCT_LEVEL.OPEN, OCT_LEVEL.COMPILE])).toBeNull();
  });
});

describe('lesserRisk — RiskTier lesser-wins helper', () => {
  it('picks LOW from {LOW, MEDIUM, HIGH}', () => {
    expect(lesserRisk([RISK_TIER.LOW, RISK_TIER.MEDIUM, RISK_TIER.HIGH])).toBe(RISK_TIER.LOW);
  });

  it('picks MEDIUM from {MEDIUM, HIGH, CRITICAL}', () => {
    expect(lesserRisk([RISK_TIER.MEDIUM, RISK_TIER.HIGH, RISK_TIER.CRITICAL])).toBe(
      RISK_TIER.MEDIUM
    );
  });

  it('returns null when a candidate is unknown', () => {
    expect(lesserRisk([RISK_TIER.LOW, 'unknown-tier'])).toBeNull();
  });
});

// ─── BakedDelegationMint tests (DMF-* acceptance gates) ─────────────────────

describe('BakedDelegationMint — DMF-01 success', () => {
  it('returns success with effectiveScope = three-way intersection', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(makeInput());

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    // explicit narrows: sales-db only; read only; chat only; OCT-CONFIDENTIAL; medium.
    expect(result.effectiveScope.targetSystems).toEqual(['sales-db']);
    expect(result.effectiveScope.capabilities).toEqual(['read']);
    expect(result.effectiveScope.runTypes).toEqual(['chat']);
    expect(result.effectiveScope.octLevel).toBe(OCT_LEVEL.CONFIDENTIAL);
    expect(result.effectiveScope.riskTier).toBe(RISK_TIER.MEDIUM);
    expect(result.effectiveScope.firewallTransitRights.outbound).toEqual(['public-api']);
    expect(result.effectiveScope.firewallTransitRights.inbound).toEqual([]);

    // Signer ran — delegation got an id + signature.
    expect(result.delegation.delegationId.length).toBeGreaterThan(0);
    expect(result.delegation.signature).toBe('sig:test');
  });
});

describe('BakedDelegationMint — DMF-02 capabilities intersect', () => {
  it('user [read,write] ∩ agent [read] ∩ explicit [read] = [read]', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ permittedCapabilities: ['read', 'write'] }),
        agentDeclaration: makeAgent({ allowedCapabilities: ['read'] }),
        explicitDelegatedScope: makeExplicit({ capabilities: ['read'] }),
      })
    );
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.effectiveScope.capabilities).toEqual(['read']);
  });
});

describe('BakedDelegationMint — DMF-03 empty intersection (capabilities)', () => {
  it('user [read] ∩ agent [write] = empty → no SignedDelegation', async () => {
    let signerCalls = 0;
    const trackingSigner: DelegationSigner = async body => {
      signerCalls++;
      return {
        ...body,
        delegationId: 'should-not-be-issued' as Uuid,
        signature: 'sig:should-not-emit' as DelegationContext['signature'],
        environment: 'dev' as DelegationContext['environment'],
        mintedBy: 'test-engine' as NonEmpty,
      };
    };
    const mint = new BakedDelegationMint({ signer: trackingSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ permittedCapabilities: ['read'] }),
        agentDeclaration: makeAgent({ allowedCapabilities: ['write'] }),
        explicitDelegatedScope: makeExplicit({ capabilities: ['write'] }),
      })
    );
    expect(result.kind).toBe('empty_intersection');
    if (result.kind !== 'empty_intersection') return;
    expect(result.dimension).toBe('capabilities');
    expect(result.userValues).toEqual(['read']);
    expect(result.agentValues).toEqual(['write']);
    expect(result.explicitValues).toEqual(['write']);
    // Signer must NOT have been invoked when intersection is empty.
    expect(signerCalls).toBe(0);
  });

  it('empty target_systems is reported before capabilities (first-failing dimension wins)', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ permittedTargetSystems: ['inventory-db' as NonEmpty] }),
        agentDeclaration: makeAgent({ visibleTargetSystems: ['sales-db' as NonEmpty] }),
      })
    );
    expect(result.kind).toBe('empty_intersection');
    if (result.kind !== 'empty_intersection') return;
    expect(result.dimension).toBe('target_systems');
  });

  it('empty oct_level when an unranked OCT is present', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ octLevel: OCT_LEVEL.COMPILE }),
      })
    );
    expect(result.kind).toBe('empty_intersection');
    if (result.kind !== 'empty_intersection') return;
    expect(result.dimension).toBe('oct_level');
  });

  it('empty run_types', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ permittedRunTypes: ['autonomous'] }),
        explicitDelegatedScope: makeExplicit({ runTypes: ['chat'] }),
      })
    );
    expect(result.kind).toBe('empty_intersection');
    if (result.kind !== 'empty_intersection') return;
    expect(result.dimension).toBe('run_types');
  });

  it('empty firewall_rights (both directions empty)', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({
          firewallTransitRights: { outbound: ['x' as NonEmpty], inbound: ['y' as NonEmpty] },
        }),
        explicitDelegatedScope: makeExplicit({
          firewallTransitRights: { outbound: ['z' as NonEmpty], inbound: ['w' as NonEmpty] },
        }),
      })
    );
    expect(result.kind).toBe('empty_intersection');
    if (result.kind !== 'empty_intersection') return;
    expect(result.dimension).toBe('firewall_rights');
  });
});

describe('BakedDelegationMint — DMF-04 mint_error (signing failures)', () => {
  it('signer throws with "signing_unavailable" → reason=signing_unavailable; no UUID fabricated', async () => {
    const failingSigner: DelegationSigner = async () => {
      throw new Error('signing_unavailable: key not found');
    };
    const mint = new BakedDelegationMint({ signer: failingSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(makeInput());

    expect(result.kind).toBe('mint_error');
    if (result.kind !== 'mint_error') return;
    expect(result.reason).toBe('signing_unavailable');
    expect(result.errorRef).toBe('err-ref-test');
    // Result must not carry a SignedDelegation envelope.
    expect((result as { delegation?: unknown }).delegation).toBeUndefined();
  });

  it('signer throws generic error → reason=signature_failed', async () => {
    const failingSigner: DelegationSigner = async () => {
      throw new Error('canonicalize broken');
    };
    const mint = new BakedDelegationMint({ signer: failingSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(makeInput());
    expect(result.kind).toBe('mint_error');
    if (result.kind !== 'mint_error') return;
    expect(result.reason).toBe('signature_failed');
  });

  it('persister throws → reason=persistence_failed', async () => {
    const failingPersister = async () => {
      throw new Error('disk full');
    };
    const mint = new BakedDelegationMint({
      signer: fixedSigner,
      newErrorRef: fixedErrorRef,
      persister: failingPersister,
    });
    const result = await mint.mint(makeInput());
    expect(result.kind).toBe('mint_error');
    if (result.kind !== 'mint_error') return;
    expect(result.reason).toBe('persistence_failed');
  });
});

describe('BakedDelegationMint — DMF-05 OCT intersection lesser-wins', () => {
  it('user OCT-OPEN, agent OCT-CONFIDENTIAL, explicit OCT-CONFIDENTIAL → OCT-OPEN', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ octLevel: OCT_LEVEL.OPEN }),
        agentDeclaration: makeAgent({ maxOctLevel: OCT_LEVEL.CONFIDENTIAL }),
        explicitDelegatedScope: makeExplicit({ maxOctLevel: OCT_LEVEL.CONFIDENTIAL }),
      })
    );
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.effectiveScope.octLevel).toBe(OCT_LEVEL.OPEN);
  });

  it('risk tier lesser-wins: user LOW, agent MEDIUM, explicit HIGH → LOW', async () => {
    const mint = new BakedDelegationMint({ signer: fixedSigner, newErrorRef: fixedErrorRef });
    const result = await mint.mint(
      makeInput({
        userClaims: makeUserClaims({ maxRiskTier: RISK_TIER.LOW }),
        agentDeclaration: makeAgent({ maxRiskTier: RISK_TIER.MEDIUM }),
        explicitDelegatedScope: makeExplicit({ maxRiskTier: RISK_TIER.HIGH }),
      })
    );
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.effectiveScope.riskTier).toBe(RISK_TIER.LOW);
  });
});
