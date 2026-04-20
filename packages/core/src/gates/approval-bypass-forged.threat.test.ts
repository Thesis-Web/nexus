/**
 * Threat test 4 — Approval Bypass: Forged Response
 * Spec §13.6, §27.2 item 4
 * ApprovalResponse with invalid signature → denied_approval (not allow).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import {
  GATE_ID,
  DENIAL_CODE,
  RISK_TIER,
  ACTOR_CLASS,
  APPROVAL_DECISION_LABEL,
  type KeyPair,
  type PipelineContext,
  type AgentAction,
  type ApprovalChannel,
  type ApprovalRequest,
  type ApprovalResponse,
  type ExecutionGrantTemplate,
} from '../types/index.js';
import { nowIso, addSeconds } from '../utils/time.js';
import { sha256 } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';

let controlPlanePair: KeyPair;

beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

function makeGrantTemplate(approvalRequired = true): ExecutionGrantTemplate {
  const body = {
    templateId: randomUUID(),
    actionId: randomUUID(),
    computedAt: nowIso(),
    capabilityId: 'send:message:external',
    scopeDescriptor: 'send:message:external@vault:message:single',
    credentialSubjectType: 'service_identity' as const,
    resourceBounds: {
      allowedResourceTypes: ['message'],
      maxRecords: 1,
      allowBulk: false,
      allowExternalFacing: true,
    },
    environmentBound: 'dev',
    expiryClass: 'action_scoped',
    maxExpirySeconds: 30,
    approvalRequired,
    approvalConfig: approvalRequired
      ? { channelId: 'test-channel', timeoutSeconds: 60, approverId: 'approver-01' }
      : null,
  };
  const fingerprint = sha256(canonicalize(body));
  return { ...body, approvalLinkage: null, templateFingerprint: fingerprint };
}

function makeAction(): AgentAction {
  return {
    actionId: randomUUID(),
    receivedAt: nowIso(),
    protocol: 'mcp',
    actorId: randomUUID(),
    principalId: randomUUID(),
    delegationId: randomUUID(),
    delegationSequence: 1,
    tool: 'send_message',
    rawVerb: 'send',
    rawTarget: {
      system: 'vault',
      resourceType: 'message',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: true,
    },
    parameters: {},
    intent: {
      objectiveSummary: 'send a message',
      triggeringSource: 'test',
      toolchainContext: null,
      modelId: null,
      modelConfidence: null,
      riskNote: null,
    },
    resolvedVerb: 'send',
    resolvedCapability: 'send:message:external',
    resolvedTarget: {
      system: 'vault',
      resourceType: 'message',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: true,
    },
    resolvedDataClasses: [],
    resolvedRiskTier: RISK_TIER.HIGH,
  } as AgentAction;
}

function makeForgedApprovalResponse(approvalId: string, approverId: string): ApprovalResponse {
  return {
    approvalId,
    decision: APPROVAL_DECISION_LABEL.APPROVED,
    decidedBy: approverId,
    decidedAt: nowIso(),
    channel: 'test-channel',
    note: null,
    signature:
      'FORGED_INVALID_SIGNATURE_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
}

describe('Threat: Approval Bypass — Forged Response (spec §13.6)', () => {
  it('rejects ApprovalResponse with invalid signature → outcome=deny, APPROVAL_SIG_INVALID', async () => {
    const template = makeGrantTemplate(true);
    const approvalId = randomUUID();
    const approverId = 'approver-01';
    const forgedResponse = makeForgedApprovalResponse(approvalId, approverId);

    // Channel returns the forged response immediately
    const fakeChannel: ApprovalChannel = {
      channelId: 'test-channel',
      dispatch: async () => {},
      awaitDecision: async () => forgedResponse,
    };

    // Approver registry with a registered approver (valid public key from control plane)
    const fakeApproverRegistry = {
      get: async (id: string) => ({
        actorId: approverId,
        actorClass: ACTOR_CLASS.HUMAN,
        principalId: randomUUID(),
        displayName: 'Test Approver',
        environment: 'dev',
        riskCeiling: RISK_TIER.CRITICAL,
        allowedSystems: ['vault'],
        registeredAt: nowIso(),
        approverPublicKey: controlPlanePair.publicKey, // valid key — forged sig will still fail
      }),
      getPublicKey: async () => controlPlanePair.publicKey,
      list: async () => [],
      register: async () => {},
    };

    const channelRegistry = {
      get: (id: string) => (id === 'test-channel' ? fakeChannel : null),
      register: () => {},
      list: () => [fakeChannel],
    };

    const context: Partial<PipelineContext> = {
      grantTemplate: template,
      approverRegistry: fakeApproverRegistry as any,
      connectorRegistry: { get: () => null, register: () => {}, list: () => [] } as any,
      channelRegistry: channelRegistry as any,
      actor: {
        actorId: randomUUID(),
        actorClass: ACTOR_CLASS.SUPERVISED_AGENT,
        principalId: randomUUID(),
        displayName: 'test',
        environment: 'dev',
        riskCeiling: RISK_TIER.HIGH,
        allowedSystems: ['vault'],
        registeredAt: nowIso(),
      },
      principal: {
        principalId: randomUUID(),
        displayName: 'test principal',
        email: 'test@test.com',
        registeredAt: nowIso(),
        maxDelegableRiskTier: RISK_TIER.HIGH,
        allowedSystems: ['vault'],
      },
    };

    const gate = new ApprovalGate(controlPlanePair);
    const result = await gate.evaluate(makeAction(), context as PipelineContext, []);

    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_SIG_INVALID);
  });
});
