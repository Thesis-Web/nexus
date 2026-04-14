/**
 * Threat test 10 — Delegation Expansion
 * Spec §13.4, §7.3, §27.2 item 10
 * DELEGATED_SUBAGENT at chain depth ceiling → CHAIN_DEPTH_EXCEEDED.
 * Sub-agent delegation cannot expand beyond parent bounds — enforced at Gate 03.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DelegationGate } from '../gates/03-delegation.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';
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
import { nowIso, addSeconds } from '../utils/time.js';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

async function makeSignedDelegation(
  overrides: Partial<Omit<DelegationContext, 'signature'>> = {}
): Promise<DelegationContext> {
  const body: Omit<DelegationContext, 'signature'> = {
    delegationId: randomUUID(),
    principalId: randomUUID(),
    actorId: randomUUID(),
    parentDelegationId: null,
    chainDepth: 0,
    maxChainDepth: 2,
    allowedSystems: ['vault'],
    allowedCapabilities: ['read:record:single'],
    forbiddenCapabilities: [],
    maxRiskTier: RISK_TIER.MEDIUM,
    allowDownstreamPropagation: true,
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

function makeSubagentActor(actorId: string, principalId: string): Actor {
  return {
    actorId,
    actorClass: ACTOR_CLASS.DELEGATED_SUBAGENT,
    principalId,
    displayName: 'subagent',
    environment: 'dev',
    riskCeiling: RISK_TIER.MEDIUM,
    allowedSystems: ['vault'],
    registeredAt: nowIso(),
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
    delegationSequence: 1,
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

describe('Threat: Delegation Expansion (spec §13.4, §7.3)', () => {
  it('denies CHAIN_DEPTH_EXCEEDED when DELEGATED_SUBAGENT reaches maxChainDepth', async () => {
    // chainDepth=2 === maxChainDepth=2 → ceiling reached → CHAIN_DEPTH_EXCEEDED
    const dc = await makeSignedDelegation({
      chainDepth: 2,
      maxChainDepth: 2,
      parentDelegationId: randomUUID(),
      allowDownstreamPropagation: true,
    });

    const context: Partial<PipelineContext> = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: makeSubagentActor(dc.actorId, dc.principalId),
    };

    const gate = new DelegationGate(controlPlanePair);
    const result = await gate.evaluate(makeAction(), context as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED);
  });

  it('denies CAPABILITY_NOT_IN_DELEGATION when subagent requests capability outside its delegation', async () => {
    // Subagent delegation only allows read:record:single
    // Action requests create:record:internal — expansion attempt
    const dc = await makeSignedDelegation({
      allowedCapabilities: ['read:record:single'],
      chainDepth: 1,
      maxChainDepth: 3,
    });

    const context: Partial<PipelineContext> = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: makeSubagentActor(dc.actorId, dc.principalId),
    };

    const gate = new DelegationGate(controlPlanePair);
    const action = makeAction({ resolvedCapability: 'create:record:internal' });
    const result = await gate.evaluate(action, context as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION);
  });

  it('non-DELEGATED_SUBAGENT at same depth does not trigger CHAIN_DEPTH_EXCEEDED', async () => {
    // SUPERVISED_AGENT — chain depth check only applies to DELEGATED_SUBAGENT
    const dc = await makeSignedDelegation({ chainDepth: 2, maxChainDepth: 2 });

    const context: Partial<PipelineContext> = {
      delegationContext: dc,
      delegationStore: makeStore(dc),
      actor: {
        actorId: dc.actorId,
        actorClass: ACTOR_CLASS.SUPERVISED_AGENT,
        principalId: dc.principalId,
        displayName: 'supervised',
        environment: 'dev',
        riskCeiling: RISK_TIER.MEDIUM,
        allowedSystems: ['vault'],
        registeredAt: nowIso(),
      },
    };

    const gate = new DelegationGate(controlPlanePair);
    const result = await gate.evaluate(makeAction(), context as PipelineContext, []);

    // Should not be CHAIN_DEPTH_EXCEEDED — that check is DELEGATED_SUBAGENT only
    expect(result.decision.denialCode).not.toBe(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED);
  });
});
