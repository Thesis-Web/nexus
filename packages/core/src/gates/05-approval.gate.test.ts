/**
 * Gate 05 — Approval — unit tests
 * Spec: nexus-engineering-spec-v1-8-26.md §13.6
 * SOLVE-016: channelId is a string on ApprovalConfig — used directly.
 *
 * Key strategy:
 *   - loadControlPlaneKey() for the gate constructor (reads existing keys/dev.keypair.json)
 *   - @noble/ed25519 in-memory key for the approver response signature
 *     (avoids filesystem/CWD issues with generateApproverKeypair)
 */

import { describe, it, expect, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import {
  DENIAL_CODE,
  OUTCOME_LABEL,
  APPROVAL_DECISION_LABEL,
  ACTION_VERB,
  type AgentAction,
  type PipelineContext,
  type ExecutionGrantTemplate,
  type ApprovalChannel,
  type ApprovalResponse,
} from '../types/index.js';

// @noble/ed25519 v2 requires sha512 setup for sync ops (we use async, but set it anyway)
ed.etc.sha512Sync = (...m: Parameters<typeof sha512>) => sha512(...m);

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();

function baseAction(): AgentAction {
  return {
    actionId: 'a-005',
    receivedAt: NOW,
    protocol: 'mcp/1.0',
    adapterVersion: 'v0.1.0',
    actorId: 'actor-001',
    principalId: 'p-001',
    sessionId: 's-001',
    delegationId: 'd-001',
    delegationSequence: 1,
    tool: 'send_message',
    rawVerb: 'send',
    rawTarget: '{}',
    rawPayload: {},
    intent: {
      objectiveSummary: 'send',
      triggeringSource: 'unknown',
      toolchainContext: 'test',
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: NOW,
    },
    resolvedVerb: ACTION_VERB.SEND,
    resolvedCapability: 'send:message:internal',
    resolvedTarget: {
      system: 'stub',
      resourceType: 'message',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    } as never,
    resolvedDataClasses: [],
    resolvedRiskTier: 'high',
  };
}

function makeTemplate(channelId: string | null = 'cli'): ExecutionGrantTemplate {
  return {
    templateId: 'tpl-001',
    actionId: 'a-005',
    computedAt: NOW,
    capabilityId: 'send:message:internal',
    system: 'stub',
    environment: 'dev',
    expiryClass: 'action_scoped',
    expiresAt: FUTURE,
    maxUsageCount: 1,
    allowedPayloadFields: [],
    redactedPayloadFields: [],
    resourceBounds: {
      allowedResourceTypes: ['message'],
      maxRecords: 1,
      allowBulk: false,
      allowExternalFacing: false,
    },
    scopeDescriptor: 'test scope',
    credentialSubjectType: 'service',
    approvalConfig: channelId ? { channelId, timeoutSeconds: 60 } : null,
    approvalRequired: true,
    approvalLinkage: null,
    templateHash: 'testhash',
    templateFingerprint: 'testfingerprint',
    grantTemplateOutcome: OUTCOME_LABEL.REQUIRE_APPROVAL,
  } as unknown as ExecutionGrantTemplate;
}

function makeCtx(
  channel: ApprovalChannel | null,
  template: ExecutionGrantTemplate
): PipelineContext {
  const channelRegistry = {
    get: vi.fn().mockReturnValue(channel),
    register: vi.fn(),
    list: vi.fn(),
  };
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
    principal: {
      principalId: 'p-001',
      displayName: 'P',
      email: 'p@test.com',
      registeredAt: NOW,
      maxDelegableRiskTier: 'high',
      allowedSystems: ['stub'],
    },
    delegationContext: {
      delegationId: 'd-001',
      principalId: 'p-001',
      actorId: 'actor-001',
      parentDelegationId: null,
      chainDepth: 0,
      maxChainDepth: 3,
      allowedSystems: ['stub'],
      allowedCapabilities: ['send:message:internal'],
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
    grantTemplate: template,
    policyFile: null,
    approverRegistry: { getPublicKey: vi.fn().mockResolvedValue(null), register: vi.fn() },
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry,
    threatLog: [],
    startedAt: NOW,
  } as unknown as PipelineContext;
}

describe('Gate 05 — Approval', () => {
  it('has gateId gate_05_approval and gateOrder 5', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    expect(gate.gateId).toBe('gate_05_approval');
    expect(gate.gateOrder).toBe(5);
    expect(gate.plane).toBe('control');
  });

  it('denies APPROVAL_CONFIG_MISSING when template has no approvalConfig', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate(null);
    const result = await gate.evaluate(baseAction(), makeCtx(null, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_CONFIG_MISSING);
  });

  it('denies APPROVAL_CHANNEL_NOT_FOUND when channel not registered', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');
    const result = await gate.evaluate(baseAction(), makeCtx(null, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_CHANNEL_NOT_FOUND);
  });

  it('denies APPROVAL_TIMEOUT when channel.awaitDecision returns null', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');
    const channel: ApprovalChannel = {
      channelId: 'cli',
      channelVersion: 'v0.1.0',
      dispatch: vi.fn().mockResolvedValue(undefined),
      awaitDecision: vi.fn().mockResolvedValue(null),
    };
    const result = await gate.evaluate(baseAction(), makeCtx(channel, template), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_TIMEOUT);
  });

  it('passes when channel returns approved response with valid approver signature', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');

    // Generate an in-memory Ed25519 key pair for the approver — avoids filesystem CWD issues
    const approverPrivBytes = ed.utils.randomPrivateKey();
    const approverPubBytes = await ed.getPublicKey(approverPrivBytes);
    const approverPubKey = Buffer.from(approverPubBytes).toString('base64url');

    // Build unsigned response body
    const approverId = 'approver-001';
    const respBodyForSigning: Omit<ApprovalResponse, 'signature'> = {
      approvalId: 'apr-001',
      decidedBy: approverId,
      decision: APPROVAL_DECISION_LABEL.APPROVED,
      decidedAt: NOW,
      channel: 'cli',
      note: null,
    };

    // Gate 05 canonicalizes body as: JSON.stringify(Object.fromEntries(Object.entries(body).sort()))
    const bodyStr = JSON.stringify(Object.fromEntries(Object.entries(respBodyForSigning).sort()));
    const sigBytes = await ed.sign(new TextEncoder().encode(bodyStr), approverPrivBytes);
    const signature = Buffer.from(sigBytes).toString('base64url');

    const response: ApprovalResponse = { ...respBodyForSigning, signature };

    const channel: ApprovalChannel = {
      channelId: 'cli',
      channelVersion: 'v0.1.0',
      dispatch: vi.fn().mockResolvedValue(undefined),
      awaitDecision: vi.fn().mockResolvedValue(response),
    };

    const ctx = makeCtx(channel, template);
    // Mock approverRegistry to return our test approver's public key
    (ctx as Record<string, unknown>).approverRegistry = {
      getPublicKey: vi.fn().mockResolvedValue(approverPubKey),
      register: vi.fn(),
    };

    const result = await gate.evaluate(baseAction(), ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.approvalResponse?.decision).toBe(APPROVAL_DECISION_LABEL.APPROVED);
  });

  it('denies APPROVAL_SIG_INVALID when approver is not registered (GATE05-001 P0 fix)', async () => {
    const kp = await loadControlPlaneKey();
    const gate = new ApprovalGate(kp);
    const template = makeTemplate('cli');

    // Unknown approver submits an APPROVED response — this MUST be denied
    const response: ApprovalResponse = {
      approvalId: 'apr-unknown',
      decision: APPROVAL_DECISION_LABEL.APPROVED,
      decidedBy: 'unknown-approver-evil',
      decidedAt: NOW,
      channel: 'cli',
      note: null,
      signature: 'forged-sig-does-not-matter',
    };

    const channel: ApprovalChannel = {
      channelId: 'cli',
      channelVersion: 'v0.1.0',
      dispatch: vi.fn().mockResolvedValue(undefined),
      awaitDecision: vi.fn().mockResolvedValue(response),
    };

    const ctx = makeCtx(channel, template);
    // approverRegistry.getPublicKey returns null — approver not registered
    (ctx as Record<string, unknown>).approverRegistry = {
      getPublicKey: vi.fn().mockResolvedValue(null),
      register: vi.fn(),
    };

    const result = await gate.evaluate(baseAction(), ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_SIG_INVALID);
    expect(result.decision.reason).toContain('not registered');
    expect(result.approvalResponse?.decidedBy).toBe('unknown-approver-evil');
  });
});
