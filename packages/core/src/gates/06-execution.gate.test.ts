/**
 * Gate 06 — Execution — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.7
 * MODULAR-005: Gate 06 calls connector interface only.
 *
 * Spec law (from implementation): connector lookup failures produce outcome='error'
 * (not 'deny') with the appropriate denialCode. Only NexusSecurityViolation from
 * the connector produces outcome='deny' (SOLVE-013).
 *
 * Connector.supportedCapabilities() is a METHOD — returns string[].
 * Connector.redeemGrant() is called before execute().
 */

import { describe, it, expect, vi } from 'vitest';
import { ExecutionGate } from '../gates/06-execution.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { buildGrantTemplate } from '../policy/grant-template-builder.js';
import {
  DENIAL_CODE,
  OUTCOME_LABEL,
  ACTION_VERB,
  ACTOR_CLASS,
  type AgentAction,
  type PipelineContext,
  type ExecutionGrantTemplate,
  type Connector,
  type PolicyRule,
} from '../types/index.js';

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();

const TEST_ACTOR = {
  actorId: 'actor-001',
  actorClass: ACTOR_CLASS.HUMAN,
  principalId: 'p-001',
  displayName: 'T',
  environment: 'dev',
  riskCeiling: 'high',
  allowedSystems: ['stub'],
  registeredAt: NOW,
  owner: null,
  purpose: null,
  reviewCadence: null,
};
const TEST_DC = {
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
};
const TEST_RULE: PolicyRule = {
  ruleId: 'rule-001',
  description: 'test',
  priority: 100,
  conditions: {}, // matches everything
  outcome: OUTCOME_LABEL.ALLOW as never,
  approvalConfig: null,
  grantHint: null,
};

function baseAction(): AgentAction {
  return {
    actionId: 'a-006',
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

function makeBaseCtx(): PipelineContext {
  return {
    sessionId: 's-001',
    actor: TEST_ACTOR,
    principal: {
      principalId: 'p-001',
      displayName: 'P',
      email: 'p@test.com',
      registeredAt: NOW,
      maxDelegableRiskTier: 'high',
      allowedSystems: ['stub'],
    },
    delegationContext: TEST_DC,
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile: null,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn().mockReturnValue(null), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [],
    startedAt: NOW,
  } as unknown as PipelineContext;
}

function makeTemplate(): ExecutionGrantTemplate {
  return buildGrantTemplate(baseAction(), TEST_RULE, makeBaseCtx());
}

function makeCtx(connector: Connector | null, template: ExecutionGrantTemplate): PipelineContext {
  const ctx = makeBaseCtx();
  (ctx as Record<string, unknown>).grantTemplate = template;
  (ctx as Record<string, unknown>).connectorRegistry = {
    get: vi.fn().mockReturnValue(connector),
    register: vi.fn(),
    list: vi.fn(),
  };
  return ctx;
}

// Full Connector mock matching the interface
function makeConnector(caps: string[]): Connector {
  return {
    systemType: 'stub',
    connectorVersion: 'v0.1.0',
    supportedCapabilities: vi.fn().mockReturnValue(caps),
    canProduceDiff: vi.fn().mockReturnValue(false),
    redeemGrant: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({
      grantId: 'grant-001',
      executedAt: NOW,
      status: 'success',
      responseCode: null,
      durationMs: 5,
      redactedSummary: null,
    }),
  };
}

describe('Gate 06 — Execution', () => {
  it('has gateId gate_06_execution, gateOrder 6, plane data', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ExecutionGate(kp);
    expect(gate.gateId).toBe('gate_06_execution');
    expect(gate.gateOrder).toBe(6);
    expect(gate.plane).toBe('data');
  });

  it('returns outcome=error with CONNECTOR_NOT_REGISTERED when no connector for system', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ExecutionGate(kp);
    const template = makeTemplate();
    const result = await gate.evaluate(baseAction(), makeCtx(null, template), []);
    // Gate 06 spec: connector lookup failure → outcome='error', not 'deny'
    expect(result.decision.outcome).toBe('error');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CONNECTOR_NOT_REGISTERED);
  });

  it('returns outcome=error with CONNECTOR_CAP_UNSUPPORTED when connector lacks capability', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ExecutionGate(kp);
    const template = makeTemplate();
    // Connector supports delete:record but NOT read:record:single
    const connector = makeConnector(['delete:record']);
    const result = await gate.evaluate(baseAction(), makeCtx(connector, template), []);
    expect(result.decision.outcome).toBe('error');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CONNECTOR_CAP_UNSUPPORTED);
  });

  it('returns outcome=pass and executionResult on successful connector execution', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ExecutionGate(kp);
    const template = makeTemplate();
    const connector = makeConnector(['read:record:single']);
    const result = await gate.evaluate(baseAction(), makeCtx(connector, template), []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.executionResult?.status).toBe('success');
    expect(connector.execute).toHaveBeenCalledOnce();
    expect(connector.redeemGrant).toHaveBeenCalledOnce();
  });
});
