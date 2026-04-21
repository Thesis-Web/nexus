/**
 * Threat test 5 — Approval Bypass: Timeout
 * Spec §13.6, §27.2 item 5
 * Channel returning null (timeout) → denied_timeout, NOT allow.
 * Timeout must never auto-approve.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import {
  DENIAL_CODE,
  RISK_TIER,
  ACTOR_CLASS,
  type KeyPair,
  type PipelineContext,
  type AgentAction,
  type ApprovalChannel,
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
    approvalConfig: { channelId: 'test-channel', timeoutSeconds: 1, approverId: 'approver-01' },
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

describe('Threat: Approval Bypass — Timeout (spec §13.6)', () => {
  it('channel returning null produces denied_timeout, never allow', async () => {
    // Channel returns null — simulates timeout
    const timeoutChannel: ApprovalChannel = {
      channelId: 'test-channel',
      dispatch: async () => {},
      awaitDecision: async () => null,
    };

    const context: Partial<PipelineContext> = {
      grantTemplate: makeGrantTemplate(),
      approverRegistry: {
        get: async () => null,
        list: async () => [],
        register: async () => {},
      } as any,
      connectorRegistry: { get: () => null, register: () => {}, list: () => [] } as any,
      channelRegistry: {
        get: (id: string) => (id === 'test-channel' ? timeoutChannel : null),
        register: () => {},
        list: () => [timeoutChannel],
      } as any,
      actor: {
        actorId: randomUUID(),
        actorClass: ACTOR_CLASS.SUPERVISED_AGENT,
        principalId: randomUUID(),
        displayName: 'test',
        environment: 'dev',
        riskCeiling: RISK_TIER.HIGH,
        octLevel: 'OCT-CONFIDENTIAL' as any,
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
    expect(result.decision.denialCode).toBe(DENIAL_CODE.APPROVAL_TIMEOUT);
    // Critical: timeout must NEVER produce outcome=allow or outcome=pass
    expect(result.decision.outcome).not.toBe('allow');
    expect(result.decision.outcome).not.toBe('pass');
  });
});
