/**
 * Gate 05 — Approval — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.6
 * SOLVE-016: channelId is a string on ApprovalConfig — used directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import {
  DENIAL_CODE, OUTCOME_LABEL, APPROVAL_DECISION_LABEL, ACTION_VERB,
  type AgentAction, type PipelineContext, type ExecutionGrantTemplate,
  type ApprovalChannel, type ApprovalRequest, type ApprovalResponse,
} from '../types/index.js';
import { generateControlPlaneKeypair } from '../crypto/key-manager.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';

const NOW    = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();

function baseAction(): AgentAction {
  return {
    actionId: 'a-005', receivedAt: NOW, protocol: 'mcp/1.0', adapterVersion: 'v0.1.0',
    actorId: 'actor-001', principalId: 'p-001', sessionId: 's-001', delegationId: 'd-001',
    delegationSequence: 1, tool: 'send_message', rawVerb: 'send', rawTarget: '{}', rawPayload: {},
    intent: { objectiveSummary: 'send', triggeringSource: 'unknown', toolchainContext: 'test', modelId: null, modelConfidence: null, riskNote: null, extractedAt: NOW },
    resolvedVerb: ACTION_VERB.SEND, resolvedCapability: 'send:message:internal',
    resolvedTarget: { system: 'stub', resourceType: 'message', resourceScope: 'single', environment: 'dev', externalFacing: false } as never,
    resolvedDataClasses: [], resolvedRiskTier: 'high',
  };
}

function makeTemplate(channelId: string | null = 'cli'): ExecutionGrantTemplate {
  return {
    templateId:     'tpl-001', ruleId: 'rule-001', actionId: 'a-005', issuedAt: NOW,
    capability:     'send:message:internal', system: 'stub', environment: 'dev',
    expiryClass:    'action_scoped', expiresAt: FUTURE, maxUsageCount: 1,
    allowedPayloadFields: [], redactedPayloadFields: [], resourceBounds: null,
    approvalConfig: channelId ? { channelId, timeoutSeconds: 60 } : null,
    templateHash:   'hash', signature: 'sig',
    grantTemplateOutcome: OUTCOME_LABEL.REQUIRE_APPROVAL,
  };
}

function makeCtx(channel: ApprovalChannel | null, template: ExecutionGrantTemplate): PipelineContext {
  const channelRegistry = {
    get: vi.fn().mockReturnValue(channel),
    register: vi.fn(), list: vi.fn(),
  };
  return {
    sessionId: 's-001',
    actor: { actorId: 'actor-001', actorClass: 'HUMAN', principalId: 'p-001', displayName: 'T', environment: 'dev', riskCeiling: 'high', allowedSystems: ['stub'], registeredAt: NOW, owner: null, purpose: null, reviewCadence: null },
    principal: { principalId: 'p-001', displayName: 'P', email: 'p@test.com', registeredAt: NOW, maxDelegableRiskTier: 'high', allowedSystems: ['stub'] },
    delegationContext: { delegationId: 'd-001', principalId: 'p-001', actorId: 'actor-001', parentDelegationId: null, chainDepth: 0, maxChainDepth: 3, allowedSystems: ['stub'], allowedCapabilities: ['send:message:internal'], forbiddenCapabilities: [], maxRiskTier: 'high', allowDownstreamPropagation: false, environment: 'dev', mintedAt: NOW, expiresAt: FUTURE, mintedBy: 'nexus-delegation-engine/v0.1.0', signature: 'sig' },
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    grantTemplate: template, policyFile: null, approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry, threatLog: [], startedAt: NOW,
  } as unknown as PipelineContext;
}

describe('Gate 05 — Approval', () => {
  it('has gateId gate_05_approval and gateOrder 5', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new ApprovalGate(kp);
    expect(gate.gateId).toBe('gate_05_approval');
    expect(gate.gateOrder).toBe(5);
  });

  it('denies APPROVAL_CONFIG_MISSING when template has no approvalConfig', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate(null);
    const result = await gate.evaluate(baseAction(), makeCtx(null, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_CONFIG_MISSING);
  });

  it('denies APPROVAL_CHANNEL_NOT_FOUND when channel not registered', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');
    const result = await gate.evaluate(baseAction(), makeCtx(null, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_CHANNEL_NOT_FOUND);
  });

  it('denies APPROVAL_TIMEOUT when channel returns timeout', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');
    const channel: ApprovalChannel = {
      channelId: 'cli', channelVersion: 'v0.1.0',
      dispatch: vi.fn().mockResolvedValue(undefined),
      awaitDecision: vi.fn().mockResolvedValue(null), // null = timeout
    };
    const result = await gate.evaluate(baseAction(), makeCtx(channel, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_TIMEOUT);
  });

  it('passes when approver returns approved response with valid signature', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');

    // Build a signed approval response matching what decideApproval would produce
    const responseBody = {
      approvalId: 'apr-001', actionId: 'a-005', decision: APPROVAL_DECISION_LABEL.APPROVED,
      approverId: 'actor-001', decidedAt: NOW, reason: 'approved',
    };
    const responseSig = await sign(canonicalize(responseBody), kp.privateKey);
    const approvalResponse: ApprovalResponse = { ...responseBody, signature: responseSig };

    const channel: ApprovalChannel = {
      channelId: 'cli', channelVersion: 'v0.1.0',
      dispatch: vi.fn().mockResolvedValue(undefined),
      awaitDecision: vi.fn().mockResolvedValue(approvalResponse),
    };
    // approverRegistry must resolve the key used to verify
    const ctx = makeCtx(channel, template);
    (ctx as Record<string, unknown>).approverRegistry = {
      get: vi.fn().mockResolvedValue({ actorId: 'actor-001', displayName: 'A', publicKey: kp.publicKey, channels: ['cli'], registeredAt: NOW }),
    };
    const result = await gate.evaluate(baseAction(), ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.approvalResponse?.decision).toBe(APPROVAL_DECISION_LABEL.APPROVED);
  });
});
