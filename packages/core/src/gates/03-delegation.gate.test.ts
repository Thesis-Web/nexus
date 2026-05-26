/**
 * Gate 03 — Delegation — unit tests
 * Spec: §13.4 | Blueprint: §8.3
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DelegationGate } from '../gates/03-delegation.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { nowIso, addSeconds } from '../utils/time.js';
import { vi } from 'vitest';
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
  type Principal,
  type RunLedgerEntry,
  type RunLedgerWriter,
} from '../types/index.js';

// ─── keypair: loaded ONCE in beforeAll — MUST be awaited ─────────────────────
let controlPlanePair: KeyPair;

beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function makeSignedDelegation(
  overrides: Partial<Omit<DelegationContext, 'signature'>> = {}
): Promise<DelegationContext> {
  const body: Omit<DelegationContext, 'signature'> = {
    delegationId: randomUUID(),
    principalId: randomUUID(),
    actorId: randomUUID(),
    parentDelegationId: null,
    chainDepth: 0,
    maxChainDepth: 3,
    allowedSystems: ['vault'],
    allowedCapabilities: ['read:record:single'],
    forbiddenCapabilities: [],
    maxRiskTier: RISK_TIER.HIGH,
    allowDownstreamPropagation: false,
    environment: 'dev',
    mintedAt: nowIso(),
    expiresAt: addSeconds(nowIso(), 3600),
    mintedBy: 'nexus-delegation-engine@v0.1.0',
    ...overrides,
  };
  const signature = await sign(canonicalize(body), controlPlanePair);
  return { ...body, signature };
}

function makeStore(dc: DelegationContext | null): DelegationStore {
  return {
    getById: async id => (dc && dc.delegationId === id ? dc : null),
    save: async () => {},
    listForActor: async () => (dc ? [dc] : []),
  };
}

function makeActor(actorId: string, principalId: string): Actor {
  return {
    actorId,
    actorClass: ACTOR_CLASS.SUPERVISED_AGENT,
    principalId,
    displayName: 'test-actor',
    environment: 'dev',
    riskCeiling: RISK_TIER.HIGH,
    octLevel: 'OCT-CONFIDENTIAL' as any,
    allowedSystems: ['vault'],
    registeredAt: nowIso(),
  };
}

function makePrincipal(principalId: string): Principal {
  return {
    principalId,
    displayName: 'test-principal',
    email: 'test@example.com',
    registeredAt: nowIso(),
    maxDelegableRiskTier: RISK_TIER.HIGH,
    allowedSystems: ['vault'],
  };
}

function makeAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    actionId: randomUUID(),
    receivedAt: nowIso(),
    protocol: 'mcp',
    actorId: randomUUID(),
    principalId: randomUUID(),
    delegationId: randomUUID(),
    delegationSequence: 0,
    tool: 'read_file',
    rawVerb: 'read',
    rawTarget: {
      system: 'vault',
      resourceType: 'secret',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    },
    parameters: {},
    intent: {
      objectiveSummary: 'test',
      triggeringSource: 'test',
      toolchainContext: null,
      modelId: null,
      modelConfidence: null,
      riskNote: null,
    },
    resolvedVerb: 'read',
    resolvedCapability: 'read:record:single',
    resolvedTarget: {
      system: 'vault',
      resourceType: 'secret',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    },
    resolvedDataClasses: [],
    resolvedRiskTier: RISK_TIER.LOW,
    ...overrides,
  } as AgentAction;
}

function makeContext(dc: DelegationContext, store?: DelegationStore): Partial<PipelineContext> {
  return {
    delegationContext: dc,
    delegationStore: store ?? makeStore(dc),
    actor: makeActor(dc.actorId, dc.principalId),
    principal: makePrincipal(dc.principalId),
  } as Partial<PipelineContext>;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Gate 03 — Delegation', () => {
  it('has gateId gate_03_delegation and gateOrder 3', () => {
    const gate = new DelegationGate(controlPlanePair);
    expect(gate.gateId).toBe(GATE_ID.G03);
    expect(gate.gateOrder).toBe(3);
    expect(gate.plane).toBe('control');
  });

  it('passes on valid delegation with correct signature', async () => {
    const dc = await makeSignedDelegation();
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });

    const result = await gate.evaluate(action, makeContext(dc) as PipelineContext, []);

    expect(result.decision.outcome).toBe('pass');
    expect(result.delegationSnapshot).toBeDefined();
    expect(result.delegationSnapshot!.delegationId).toBe(dc.delegationId);
  });

  it('denies DELEGATION_SIG_INVALID when signature does not verify', async () => {
    const dc = await makeSignedDelegation();
    const tampered: DelegationContext = {
      ...dc,
      signature: dc.signature.slice(0, -4) + 'XXXX',
    };

    const gate = new DelegationGate(controlPlanePair);
    const result = await gate.evaluate(makeAction(), makeContext(tampered) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_SIG_INVALID);
  });

  it('denies DELEGATION_EXPIRED when delegation is past expiresAt', async () => {
    const dc = await makeSignedDelegation({ expiresAt: addSeconds(nowIso(), -60) });
    const gate = new DelegationGate(controlPlanePair);

    const result = await gate.evaluate(makeAction(), makeContext(dc) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_EXPIRED);
  });

  it('denies CAPABILITY_NOT_IN_DELEGATION when capability not allowed', async () => {
    const dc = await makeSignedDelegation({ allowedCapabilities: ['create:record:internal'] });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
    });

    const result = await gate.evaluate(action, makeContext(dc) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION);
  });

  it('denies SYSTEM_NOT_IN_DELEGATION when action system not in allowedSystems', async () => {
    const dc = await makeSignedDelegation({ allowedSystems: ['other-system'] });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
    });

    const result = await gate.evaluate(action, makeContext(dc) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION);
  });

  it('denies ENVIRONMENT_MISMATCH when action target env differs from delegation env', async () => {
    // Delegation scoped to 'production'; action resolves to 'dev'
    const dc = await makeSignedDelegation({ environment: 'production' });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
    });

    const result = await gate.evaluate(action, makeContext(dc) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ENVIRONMENT_MISMATCH);
  });

  // ─── Delegation-to-context binding tests (DEF-GATE03-001) ──────────────────

  it('denies DELEGATION_ACTOR_MISMATCH when dc.actorId != resolved actor', async () => {
    const dc = await makeSignedDelegation();
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    // Context with a DIFFERENT actor than delegation expects
    const ctx = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: makeActor('mismatched-actor-id', dc.principalId),
      principal: makePrincipal(dc.principalId),
    } as unknown as PipelineContext;

    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_ACTOR_MISMATCH);
  });

  it('denies DELEGATION_PRINCIPAL_MISMATCH when dc.principalId != resolved principal', async () => {
    const dc = await makeSignedDelegation();
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    // Context with matching actor but DIFFERENT principal
    const ctx = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: makeActor(dc.actorId, dc.principalId),
      principal: makePrincipal('mismatched-principal-id'),
    } as unknown as PipelineContext;

    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_PRINCIPAL_MISMATCH);
  });

  it('denies CHAIN_INTEGRITY_BROKEN when dc.delegationId != action.delegationId', async () => {
    const dc = await makeSignedDelegation();
    const gate = new DelegationGate(controlPlanePair);
    // Action has a DIFFERENT delegationId than dc
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: 'mismatched-delegation-id',
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });

    const result = await gate.evaluate(action, makeContext(dc) as PipelineContext, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN);
  });

  it('denies CHAIN_INTEGRITY_BROKEN when parent delegation is missing from store (spec §13.4)', async () => {
    const missingParentId = randomUUID();
    // allowDownstreamPropagation: true so the propagation check passes;
    // gate then walks the chain, finds parent missing, throws DelegationChainIntegrityError
    const dc = await makeSignedDelegation({
      parentDelegationId: missingParentId,
      chainDepth: 1,
      allowDownstreamPropagation: true,
      environment: 'dev',
      allowedSystems: ['vault'],
      allowedCapabilities: ['read:record:single'],
    });

    const emptyStore: DelegationStore = {
      getById: async () => null,
      save: async () => {},
      listForActor: async () => [],
    };

    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });

    const result = await gate.evaluate(action, makeContext(dc, emptyStore) as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN);
  });

  // ─── GATE03-002: Chain-depth enforcement proof (DELEGATED_SUBAGENT only) ───

  it('denies CHAIN_DEPTH_EXCEEDED when chainDepth >= maxChainDepth for DELEGATED_SUBAGENT', async () => {
    // chainDepth=3, maxChainDepth=3 → 3 >= 3 → must deny
    const dc = await makeSignedDelegation({
      chainDepth: 3,
      maxChainDepth: 3,
      allowDownstreamPropagation: true,
      environment: 'dev',
    });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    // Actor MUST be DELEGATED_SUBAGENT for chain-depth check to fire
    const ctx = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: {
        ...makeActor(dc.actorId, dc.principalId),
        actorClass: ACTOR_CLASS.DELEGATED_SUBAGENT,
      },
      principal: makePrincipal(dc.principalId),
    } as unknown as PipelineContext;

    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED);
  });

  it('does NOT deny chain-depth when actor is not DELEGATED_SUBAGENT (GATE03-002 conditional proof)', async () => {
    // Same chainDepth >= maxChainDepth, but actor is SUPERVISED_AGENT → should pass
    const dc = await makeSignedDelegation({
      chainDepth: 3,
      maxChainDepth: 3,
      allowDownstreamPropagation: true,
      environment: 'dev',
    });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    // Actor is SUPERVISED_AGENT — NOT DELEGATED_SUBAGENT
    const ctx = makeContext(dc) as PipelineContext;

    const result = await gate.evaluate(action, ctx, []);
    // Chain-depth check is conditional on DELEGATED_SUBAGENT — must pass for other classes
    expect(result.decision.outcome).toBe('pass');
  });

  // ── Phase 5 canonical surface — Gate 03 single-event denials ──────────

  it('Phase 5 — emits chain_depth_exceeded event when DELEGATED_SUBAGENT hits ceiling', async () => {
    const dc = await makeSignedDelegation({
      chainDepth: 3,
      maxChainDepth: 3,
      allowDownstreamPropagation: true,
      environment: 'dev',
    });
    const writes: RunLedgerEntry[] = [];
    const runLedger: RunLedgerWriter = {
      writeEvent: vi.fn(async (entry: RunLedgerEntry) => {
        writes.push(entry);
      }),
    };
    const gate = new DelegationGate(controlPlanePair, runLedger);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    const ctx = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: {
        ...makeActor(dc.actorId, dc.principalId),
        actorClass: ACTOR_CLASS.DELEGATED_SUBAGENT,
      },
      principal: makePrincipal(dc.principalId),
    } as unknown as PipelineContext;

    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED);

    const events = writes.filter(e => e.eventType === 'chain_depth_exceeded');
    expect(events.length, 'exactly one chain_depth_exceeded event per denial').toBe(1);
    expect(events[0]!.detail['chainDepth']).toBe(3);
    expect(events[0]!.detail['maxChainDepth']).toBe(3);
    expect(events[0]!.detail['actorClass']).toBe(ACTOR_CLASS.DELEGATED_SUBAGENT);
  });

  it('Phase 5 — emits environment_mismatch event when action env differs from delegation env', async () => {
    const dc = await makeSignedDelegation({
      chainDepth: 0,
      maxChainDepth: 3,
      allowDownstreamPropagation: false,
      environment: 'dev',
    });
    const writes: RunLedgerEntry[] = [];
    const runLedger: RunLedgerWriter = {
      writeEvent: vi.fn(async (entry: RunLedgerEntry) => {
        writes.push(entry);
      }),
    };
    const gate = new DelegationGate(controlPlanePair, runLedger);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        // Action targets prod; delegation is dev → mismatch
        environment: 'prod',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    const ctx = makeContext(dc) as PipelineContext;
    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ENVIRONMENT_MISMATCH);

    const events = writes.filter(e => e.eventType === 'environment_mismatch');
    expect(events.length, 'exactly one environment_mismatch event per denial').toBe(1);
    expect(events[0]!.detail['delegationEnvironment']).toBe('dev');
    expect(events[0]!.detail['actionEnvironment']).toBe('prod');
  });

  it('Phase 5 — does NOT emit chain_depth_exceeded when no runLedger is wired', async () => {
    // Backward-compat: single-arg constructor stays silent.
    const dc = await makeSignedDelegation({
      chainDepth: 3,
      maxChainDepth: 3,
      allowDownstreamPropagation: true,
      environment: 'dev',
    });
    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({
      actorId: dc.actorId,
      principalId: dc.principalId,
      delegationId: dc.delegationId,
      resolvedCapability: 'read:record:single',
      resolvedTarget: {
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'single',
        environment: 'dev',
        externalFacing: false,
      },
      resolvedRiskTier: RISK_TIER.LOW,
    });
    const ctx = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: {
        ...makeActor(dc.actorId, dc.principalId),
        actorClass: ACTOR_CLASS.DELEGATED_SUBAGENT,
      },
      principal: makePrincipal(dc.principalId),
    } as unknown as PipelineContext;
    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED);
  });
});
