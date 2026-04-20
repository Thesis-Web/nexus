/**
 * Threat test 6 — Approval Bypass: Unsigned Response
 * Spec §13.6, §27.2 item 6
 * ApprovalResponse with empty signature string → deny (APPROVAL_SIG_INVALID).
 * Empty string must never pass signature verification.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import {
  DENIAL_CODE,
  RISK_TIER,
  ACTOR_CLASS,
  APPROVAL_DECISION_LABEL,
  type KeyPair,
  type PipelineContext,
  type AgentAction,
  type ApprovalChannel,
  type ApprovalResponse,
  type ExecutionGrantTemplate,
} from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { sha256 } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

function makeGrantTemplate(): ExecutionGrantTemplate {
  const body = {
    templateId: randomUUID(),
    actionId: randomUUID(),
    computedAt: nowIso(),
    capabilityId: 'send:message:external',
    scopeDescriptor: 'send@vault:message:single',
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
    approvalRequired: true,
    approvalConfig: { channelId: 'test-channel', timeoutSeconds: 60, approverId: 'approver-01' },
  };
  return { ...body, approvalLinkage: null, templateFingerprint: sha256(canonicalize(body)) };
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
      objectiveSummary: 'test',
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

describe('Threat: Approval Bypass — Unsigned Response (spec §13.6)', () => {
  it('ApprovalResponse with empty signature is denied → APPROVAL_SIG_INVALID', async () => {
    const unsignedResponse: ApprovalResponse = {
      approvalId: randomUUID(),
      decision: APPROVAL_DECISION_LABEL.APPROVED,
      decidedBy: 'approver-01',
      decidedAt: nowIso(),
      channel: 'test-channel',
      note: null,
      signature: '', // empty — no signature
    };

    const fakeChannel: ApprovalChannel = {
      channelId: 'test-channel',
      dispatch: async () => {},
      awaitDecision: async () => unsignedResponse,
    };

    const fakeApproverRegistry = {
      get: async (id: string) => ({
        actorId: id,
        actorClass: ACTOR_CLASS.HUMAN,
        principalId: randomUUID(),
        displayName: 'approver',
        environment: 'dev',
        riskCeiling: RISK_TIER.CRITICAL,
        allowedSystems: ['vault'],
        registeredAt: nowIso(),
        approverPublicKey: controlPlanePair.publicKey,
      }),
      getPublicKey: async () => controlPlanePair.publicKey,
      list: async () => [],
      register: async () => {},
    };

    const context: Partial<PipelineContext> = {
      grantTemplate: makeGrantTemplate(),
      approverRegistry: fakeApproverRegistry as any,
      connectorRegistry: { get: () => null, register: () => {}, list: () => [] } as any,
      channelRegistry: {
        get: (id: string) => (id === 'test-channel' ? fakeChannel : null),
        register: () => {},
        list: () => [fakeChannel],
      } as any,
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
