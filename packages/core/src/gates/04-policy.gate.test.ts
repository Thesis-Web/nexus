/**
 * Gate 04 — Policy — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.5
 */

import { describe, it, expect, vi } from 'vitest';
import { PolicyGate } from '../gates/04-policy.gate.js';
import {
  DENIAL_CODE, OUTCOME_LABEL, ACTION_VERB,
  type AgentAction, type PipelineContext, type LoadedPolicyFile, type PolicyRule,
} from '../types/index.js';

const NOW = new Date().toISOString();

function baseAction(): AgentAction {
  return {
    actionId: 'a-004', receivedAt: NOW, protocol: 'mcp/1.0', adapterVersion: 'v0.1.0',
    actorId: 'actor-001', principalId: 'p-001', sessionId: 's-001', delegationId: 'd-001',
    delegationSequence: 1, tool: 'get_record', rawVerb: 'read', rawTarget: '{}', rawPayload: {},
    intent: { objectiveSummary: 'test', triggeringSource: 'unknown', toolchainContext: 'test', modelId: null, modelConfidence: null, riskNote: null, extractedAt: NOW },
    resolvedVerb: ACTION_VERB.READ, resolvedCapability: 'read:record:single',
    resolvedTarget: { system: 'stub', resourceType: 'record', resourceScope: 'single', environment: 'dev', externalFacing: false } as never,
    resolvedDataClasses: ['internal'], resolvedRiskTier: 'low',
  };
}

function makeCtx(policyFile: LoadedPolicyFile | null): PipelineContext {
  return {
    sessionId: 's-001',
    actor: { actorId: 'actor-001', actorClass: 'HUMAN', principalId: 'p-001', displayName: 'T', environment: 'dev', riskCeiling: 'high', allowedSystems: ['stub'], registeredAt: NOW, owner: null, purpose: null, reviewCadence: null },
    delegationContext: { delegationId: 'd-001', principalId: 'p-001', actorId: 'actor-001', parentDelegationId: null, chainDepth: 0, maxChainDepth: 3, allowedSystems: ['stub'], allowedCapabilities: ['read:record:single'], forbiddenCapabilities: [], maxRiskTier: 'high', allowDownstreamPropagation: false, environment: 'dev', mintedAt: NOW, expiresAt: new Date(Date.now() + 300000).toISOString(), mintedBy: 'nexus-delegation-engine/v0.1.0', signature: 'sig' },
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile, approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [], startedAt: NOW,
  } as unknown as PipelineContext;
}

function makePolicy(outcome: string): LoadedPolicyFile {
  const rule: PolicyRule = {
    ruleId: 'rule-001', description: 'test rule', priority: 100,
    conditions: [{ field: 'riskTier', operator: 'equals', value: 'low' }],
    outcome: outcome as never, grantTemplateHints: null, approvalConfig: null,
    createdAt: NOW,
  };
  return {
    policyId: 'policy-001', version: 'v1', description: 'test',
    createdAt: NOW, signature: 'sig', policyHash: 'hash',
    rules: [rule], sortedRules: [rule],
  };
}

describe('Gate 04 — Policy', () => {
  it('denies DEFAULT_DENY when no policy file loaded', async () => {
    const gate = new PolicyGate();
    const result = await gate.evaluate(baseAction(), makeCtx(null), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DEFAULT_DENY);
  });

  it('denies POLICY_DENY when matched rule outcome is deny', async () => {
    const gate = new PolicyGate();
    const result = await gate.evaluate(baseAction(), makeCtx(makePolicy(OUTCOME_LABEL.DENY)), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.POLICY_DENY);
  });

  it('passes and sets grantTemplate when matched rule outcome is allow', async () => {
    const gate = new PolicyGate();
    const result = await gate.evaluate(baseAction(), makeCtx(makePolicy(OUTCOME_LABEL.ALLOW)), []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.grantTemplate).toBeDefined();
  });

  it('passes with require_approval outcome (route to Gate 05)', async () => {
    const gate = new PolicyGate();
    const result = await gate.evaluate(baseAction(), makeCtx(makePolicy(OUTCOME_LABEL.REQUIRE_APPROVAL)), []);
    // Gate 04 passes; orchestrator routes to Gate 05
    expect(result.decision.outcome).toBe('pass');
    expect(result.grantTemplate).toBeDefined();
  });

  it('has gateId gate_04_policy and gateOrder 4', () => {
    const gate = new PolicyGate();
    expect(gate.gateId).toBe('gate_04_policy');
    expect(gate.gateOrder).toBe(4);
    expect(gate.plane).toBe('control');
  });
});
