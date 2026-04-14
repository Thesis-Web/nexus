/**
 * Gate 02 — Classification — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.3
 */

import { describe, it, expect, vi } from 'vitest';
import { ClassificationGate } from '../gates/02-classification.gate.js';
import {
  DENIAL_CODE, ACTION_VERB,
  type AgentAction, type PipelineContext,
} from '../types/index.js';

const NOW = new Date().toISOString();

function makeAction(verb: string, target: string): AgentAction {
  return {
    actionId: 'a-002', receivedAt: NOW, protocol: 'mcp/1.0', adapterVersion: 'v0.1.0',
    actorId: 'actor-001', principalId: 'p-001', sessionId: 's-001', delegationId: 'd-001',
    delegationSequence: 1, tool: 'get_record', rawVerb: verb, rawTarget: target, rawPayload: {},
    intent: { objectiveSummary: 'test', triggeringSource: 'unknown', toolchainContext: 'test', modelId: null, modelConfidence: null, riskNote: null, extractedAt: NOW },
    resolvedVerb: null, resolvedCapability: null, resolvedTarget: null, resolvedDataClasses: [], resolvedRiskTier: null,
  };
}

function makeCtx(): PipelineContext {
  return {
    sessionId: 's-001',
    actor: { actorId: 'actor-001', actorClass: 'HUMAN', principalId: 'p-001', displayName: 'T', environment: 'dev', riskCeiling: 'high', allowedSystems: ['stub'], registeredAt: NOW, owner: null, purpose: null, reviewCadence: null },
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile: null, approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [], startedAt: NOW,
  } as unknown as PipelineContext;
}

function makeGate(verbResult: string | null, targetResult: object | null, capResult: string | null, riskResult: string | null) {
  const vn = { normalize: vi.fn().mockReturnValue(verbResult) };
  const tn = { normalize: vi.fn().mockReturnValue(targetResult) };
  const dc = { classify: vi.fn().mockReturnValue([]) };
  const rc = { compute: vi.fn().mockReturnValue(riskResult) };
  return { gate: new ClassificationGate(vn as never, tn as never, dc as never, rc as never), vn, tn };
}

describe('Gate 02 — Classification', () => {
  it('passes and sets resolved fields on nominal path', async () => {
    const tgt = { system: 'stub', resourceType: 'record', resourceScope: 'single', environment: 'dev', externalFacing: false };
    const { gate } = makeGate(ACTION_VERB.READ, tgt, 'read:record:single', 'low');
    const action = makeAction('read', JSON.stringify({ system: 'stub', resourceType: 'record', resourceScope: 'single', environment: 'ACTOR_ENVIRONMENT', externalFacing: false }));
    const ctx = makeCtx();
    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.actionMutations?.resolvedVerb).toBe(ACTION_VERB.READ);
    expect(result.actionMutations?.resolvedRiskTier).toBeDefined();
  });

  it('denies UNRESOLVABLE_VERB when verb normalizer returns null', async () => {
    const { gate } = makeGate(null, {}, 'read:record:single', 'low');
    const result = await gate.evaluate(makeAction('???', '{}'), makeCtx(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.UNRESOLVABLE_VERB);
  });

  it('denies UNRESOLVABLE_TARGET when target normalizer returns null', async () => {
    const { gate } = makeGate(ACTION_VERB.READ, null, 'read:record:single', 'low');
    const result = await gate.evaluate(makeAction('read', 'bad-target'), makeCtx(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.UNRESOLVABLE_TARGET);
  });

  it('has gateId gate_02_classification and gateOrder 2', () => {
    const { gate } = makeGate('read', {}, 'x', 'low');
    expect(gate.gateId).toBe('gate_02_classification');
    expect(gate.gateOrder).toBe(2);
  });
});
