/**
 * Gate 03 — Delegation — unit tests
 * Spec: §13.4 | Blueprint: §8.3
 *
 * Key requirement (SOLVE-006 / HOLE-002):
 *   loadControlPlaneKey() is async — MUST be awaited in beforeAll.
 *   Calling it without await returns a Promise; Promise.privateKey is undefined.
 *   This test suite uses beforeAll to load the keypair once before all tests run.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DelegationGate } from '../gates/03-delegation.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { nowIso, addSeconds, uuid } from '../utils/time.js';
import {
  GATE_ID,
  DENIAL_CODE,
  ACTOR_CLASS,
  RISK_TIER,
  type DelegationContext,
  type PipelineContext,
  type AgentAction,
  type DelegationStore,
  type KeyPair,
  type Actor,
} from '../types/index.js';

// ─── keypair loaded once (MUST await) ────────────────────────────────────────
let controlPlanePair: KeyPair;

beforeAll(async () => {
  // loadControlPlaneKey() is async — await is mandatory.
  // Missing await causes kp to be a Promise; kp.privateKey === undefined → sign() throws.
  controlPlanePair = await loadControlPlaneKey();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function makeSignedDelegation(
  overrides: Partial<Omit<DelegationContext, 'signature'>> = {},
): Promise<DelegationContext> {
  const body: Omit<DelegationContext, 'signature'> = {
    delegationId:               uuid(),
    principalId:                uuid(),
    actorId:                    uuid(),
    parentDelegationId:         null,
    chainDepth:                 0,
    maxChainDepth:              3,
    allowedSystems:             ['vault'],
    allowedCapabilities:        ['read:record:single'],
    forbiddenCapabilities:      [],
    maxRiskTier:                RISK_TIER.HIGH,
    allowDownstreamPropagation: false,
    environment:                'dev',
    mintedAt:                   nowIso(),
    expiresAt:                  addSeconds(nowIso(), 3600),
    mintedBy:                   'nexus-delegation-engine@v0.1.0',
    ...overrides,
  };
  // sign() requires the full KeyPair — not just the privateKey string.
  // controlPlanePair is populated by beforeAll; never undefined here.
  const signature = await sign(canonicalize(body), controlPlanePair);
  return { ...body, signature };
}

function makeStore(dc: DelegationContext | null): DelegationStore {
  return {
    getById:      async (id) => (dc && dc.delegationId === id ? dc : null),
    save:         async () => {},
    listForActor: async () => (dc ? [dc] : []),
  };
}

function makeActor(actorId: string, principalId: string): Actor {
  return {
    actorId,
    actorClass:     ACTOR_CLASS.SUPERVISED_AGENT,
    principalId,
    displayName:    'test-actor',
    environment:    'dev',
    riskCeiling:    RISK_TIER.HIGH,
    allowedSystems: ['vault'],
    registeredAt:   nowIso(),
  };
}

function makeAction(
  overrides: Partial<AgentAction> = {},
): AgentAction {
  return {
    actionId:            uuid(),
    receivedAt:          nowIso(),
    protocol:            'mcp',
    actorId:             uuid(),
    principalId:         uuid(),
    delegationId:        uuid(),
    delegationSequence:  0,
    tool:                'read_file',
    rawVerb:             'read',
    rawTarget:           {
      system: 'vault', resourceType: 'secret',
      resourceScope: 'single', environment: 'dev', externalFacing: false,
    },
    parameters:          {},
    intent: {
      objectiveSummary: 'test', triggeringSource: 'test',
      toolchainContext: null, modelId: null, modelConfidence: null, riskNote: null,
    },
    resolvedVerb:        'read',
    resolvedCapability:  'read:record:single',
    resolvedTarget:      {
      system: 'vault', resourceType: 'secret',
      resourceScope: 'single', environment: 'dev', externalFacing: false,
    },
    resolvedDataClasses: [],
    resolvedRiskTier:    RISK_TIER.LOW,
    ...overrides,
  } as AgentAction;
}

function makeContext(
  dc: DelegationContext,
  store?: DelegationStore,
): Partial<PipelineContext> {
  return {
    delegationContext: dc,
    delegationStore:   store ?? makeStore(dc),
    actor:             makeActor(dc.actorId, dc.principalId),
  } as Partial<PipelineContext>;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Gate 03 — Delegation', () => {

  it('has gateId gate_03_delegation and gateOrder 3', () => {
    const gate = new DelegationGate();
    expect(gate.gateId).toBe(GATE_ID.G03);
    expect(gate.gateOrder).toBe(3);
    expect(gate.plane).toBe('control');
  });

  it('passes on valid delegation with correct signature', async () => {
    const dc   = await makeSignedDelegation();
    const gate = new DelegationGate();
    const action = makeAction({
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault', resourceType: 'secret',
        resourceScope: 'single', environment: 'dev', externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });

    const result = await gate.evaluate(
      action,
      makeContext(dc) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('pass');
    expect(result.delegationSnapshot).toBeDefined();
    expect(result.delegationSnapshot!.delegationId).toBe(dc.delegationId);
  });

  it('denies DELEGATION_SIG_INVALID when signature does not verify', async () => {
    const dc = await makeSignedDelegation();
    // tamper: replace last 4 chars of signature
    const tampered: DelegationContext = {
      ...dc,
      signature: dc.signature.slice(0, -4) + 'XXXX',
    };

    const gate   = new DelegationGate();
    const result = await gate.evaluate(
      makeAction(),
      makeContext(tampered) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_SIG_INVALID);
  });

  it('denies DELEGATION_EXPIRED when delegation is past expiresAt', async () => {
    // Sign the body with an already-expired expiresAt — sig is valid, but gate checks expiry
    const dc   = await makeSignedDelegation({ expiresAt: addSeconds(nowIso(), -60) });
    const gate = new DelegationGate();

    const result = await gate.evaluate(
      makeAction(),
      makeContext(dc) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_EXPIRED);
  });

  it('denies CAPABILITY_NOT_IN_DELEGATION when capability not allowed', async () => {
    const dc   = await makeSignedDelegation({
      allowedCapabilities: ['create:record:internal'],
    });
    const gate   = new DelegationGate();
    const action = makeAction({ resolvedCapability: 'read:record:single' });

    const result = await gate.evaluate(
      action,
      makeContext(dc) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION);
  });

  it('denies SYSTEM_NOT_IN_DELEGATION when action system not in allowedSystems', async () => {
    const dc = await makeSignedDelegation({ allowedSystems: ['other-system'] });
    const gate = new DelegationGate();
    const action = makeAction({
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault', resourceType: 'secret',
        resourceScope: 'single', environment: 'dev', externalFacing: false,
      },
    });

    const result = await gate.evaluate(
      action,
      makeContext(dc) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION);
  });

  it('denies ENVIRONMENT_MISMATCH when action target env differs from delegation env', async () => {
    // Delegation scoped to 'production'; action targets 'dev'
    const dc   = await makeSignedDelegation({ environment: 'production' });
    const gate = new DelegationGate();
    const action = makeAction({
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault', resourceType: 'secret',
        resourceScope: 'single', environment: 'dev', externalFacing: false,
      },
    });

    const result = await gate.evaluate(
      action,
      makeContext(dc) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ENVIRONMENT_MISMATCH);
  });

  it('denies CHAIN_INTEGRITY_BROKEN when parent delegation is missing from store (spec §13.4)', async () => {
    const missingParentId = uuid();
    // chainDepth=1 means it has a parent; allowDownstreamPropagation=true so propagation
    // check passes; the chain verifier then discovers the missing parent and throws.
    const dc = await makeSignedDelegation({
      parentDelegationId:         missingParentId,
      chainDepth:                 1,
      allowDownstreamPropagation: true,
      environment:                'dev',   // matches action target env
      allowedSystems:             ['vault'],
      allowedCapabilities:        ['read:record:single'],
    });

    // Store returns null for the parent — chain is broken
    const emptyStore: DelegationStore = {
      getById:      async () => null,
      save:         async () => {},
      listForActor: async () => [],
    };

    const gate   = new DelegationGate();
    const action = makeAction({
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault', resourceType: 'secret',
        resourceScope: 'single', environment: 'dev', externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });

    const result = await gate.evaluate(
      action,
      makeContext(dc, emptyStore) as PipelineContext,
      [],
    );

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN);
  });

});
