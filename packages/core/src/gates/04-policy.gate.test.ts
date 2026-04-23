/**
 * Gate 04 — Policy — unit tests
 * Spec: nexus-engineering-spec-v1-8-26.md §13.5
 *
 * DEFAULT_DENY: only when context.policyFile is null.
 * POLICY_DENY:  when a policy is loaded but no rule matches (or matched rule outcome = deny).
 *
 * PolicyCondition uses named array fields (riskTiers, capabilities, etc.).
 * Empty condition {} matches all actions. { riskTiers: ['critical'] } does not match low-risk.
 * Gate 04 decision.outcome = the policy outcome label ('allow', 'require_approval', 'deny').
 */

import { describe, it, expect, vi } from 'vitest';
import { PolicyGate } from '../gates/04-policy.gate.js';
import {
  DENIAL_CODE,
  OUTCOME_LABEL,
  ACTION_VERB,
  type AgentAction,
  type PipelineContext,
  type LoadedPolicyFile,
  type PolicyRule,
} from '../types/index.js';

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();

function baseAction(): AgentAction {
  return {
    actionId: 'a-004',
    receivedAt: NOW,
    protocol: 'mcp/1.0',
    adapterVersion: 'v0.1.0',
    actorId: 'actor-001',
    principalId: 'p-001',
    sessionId: 's-001',
    delegationId: 'd-001',
    delegationSequence: 1,
    tool: 'get_record',
    rawVerb: 'read',
    rawTarget: '{}',
    rawPayload: {},
    intent: {
      objectiveSummary: 'test',
      triggeringSource: 'unknown',
      toolchainContext: 'test',
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: NOW,
    },
    resolvedVerb: ACTION_VERB.READ,
    resolvedCapability: 'read:record:single',
    resolvedTarget: {
      system: 'stub',
      resourceType: 'record',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    } as never,
    resolvedDataClasses: ['internal'],
    resolvedRiskTier: 'low',
  };
}

function makeCtx(policyFile: LoadedPolicyFile | null): PipelineContext {
  return {
    sessionId: 's-001',
    actor: {
      actorId: 'actor-001',
      actorClass: 'HUMAN',
      principalId: 'p-001',
      displayName: 'T',
      environment: 'dev',
      riskCeiling: 'high',
      octLevel: 'OCT-CONFIDENTIAL' as any,
      allowedSystems: ['stub'],
      registeredAt: NOW,
      owner: null,
      purpose: null,
      reviewCadence: null,
    },
    delegationContext: {
      delegationId: 'd-001',
      principalId: 'p-001',
      actorId: 'actor-001',
      parentDelegationId: null,
      chainDepth: 0,
      maxChainDepth: 3,
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single'],
      forbiddenCapabilities: [],
      maxRiskTier: 'high',
      allowDownstreamPropagation: false,
      environment: 'dev',
      mintedAt: NOW,
      expiresAt: FUTURE,
      mintedBy: 'nexus-delegation-engine/v0.1.0',
      signature: 'sig',
    },
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [],
    startedAt: NOW,
  } as unknown as PipelineContext;
}

function makePolicy(outcome: string, conditions: Record<string, unknown> = {}): LoadedPolicyFile {
  const rule: PolicyRule = {
    ruleId: 'rule-001',
    description: 'test rule',
    priority: 100,
    conditions: conditions as never,
    outcome: outcome as never,
    approvalConfig: null,
    grantHint: null,
  };
  return {
    policyId: 'policy-001',
    version: 'v1',
    description: 'test',
    createdAt: NOW,
    signature: 'sig',
    policyHash: 'hash',
    bundleHash: 'bundlehash',
    rules: [rule],
    sortedRules: [rule],
  };
}

describe('Gate 04 — Policy', () => {
  it('denies DEFAULT_DENY when no policy file loaded', async () => {
    const result = await new PolicyGate().evaluate(baseAction(), makeCtx(null), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DEFAULT_DENY);
  });

  it('denies POLICY_DENY when matched rule outcome is deny', async () => {
    const result = await new PolicyGate().evaluate(
      baseAction(),
      makeCtx(makePolicy(OUTCOME_LABEL.DENY)),
      []
    );
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.POLICY_DENY);
  });

  it('returns allow outcome and sets grantTemplate when matched rule is allow', async () => {
    const result = await new PolicyGate().evaluate(
      baseAction(),
      makeCtx(makePolicy(OUTCOME_LABEL.ALLOW)),
      []
    );
    expect(result.decision.outcome).toBe(OUTCOME_LABEL.ALLOW);
    expect(result.grantTemplate).toBeDefined();
    expect(result.grantTemplate?.capabilityId).toBe('read:record:single');
  });

  it('returns require_approval outcome — orchestrator routes to Gate 05', async () => {
    const result = await new PolicyGate().evaluate(
      baseAction(),
      makeCtx(makePolicy(OUTCOME_LABEL.REQUIRE_APPROVAL)),
      []
    );
    expect(result.decision.outcome).toBe(OUTCOME_LABEL.REQUIRE_APPROVAL);
    expect(result.grantTemplate).toBeDefined();
  });

  it('denies POLICY_DENY when no rule matches the action conditions', async () => {
    // riskTiers: ['critical'] does NOT match resolvedRiskTier: 'low'
    // No match → default fallback → DENY outcome → POLICY_DENY code
    const result = await new PolicyGate().evaluate(
      baseAction(),
      makeCtx(makePolicy(OUTCOME_LABEL.ALLOW, { riskTiers: ['critical'] })),
      []
    );
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.POLICY_DENY);
  });

  it('has gateId gate_04_policy, gateOrder 4, plane control', () => {
    const gate = new PolicyGate();
    expect(gate.gateId).toBe('gate_04_policy');
    expect(gate.gateOrder).toBe(4);
    expect(gate.plane).toBe('control');
  });
});
