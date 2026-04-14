/**
 * Gate 07 — Evidence — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.8
 * Gate 07 always runs regardless of prior gate outcomes.
 * CCV is inside the signed body (MODULAR-009).
 * computeFinalOutcome uses denialCode, not reason string.
 */

import { describe, it, expect, vi } from 'vitest';
import { EvidenceGate } from '../gates/07-evidence.gate.js';
import {
  DENIAL_CODE,
  FINAL_OUTCOME,
  GATE_ID,
  ACTION_VERB,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type LedgerBackend,
  type EvidenceRecord,
} from '../types/index.js';
import { generateControlPlaneKeypair } from '../crypto/key-manager.js';

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();

function baseAction(): AgentAction {
  return {
    actionId: 'a-007',
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

function makeCtx(finalOutcomeSuffix?: 'with_grant'): PipelineContext {
  return {
    sessionId: 's-001',
    actor: {
      actorId: 'actor-001',
      actorClass: 'HUMAN',
      principalId: 'p-001',
      displayName: 'T',
      environment: 'dev',
      riskCeiling: 'high',
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
    policyFile: null,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [],
    startedAt: NOW,
    delegationSnapshot: undefined,
  } as unknown as PipelineContext;
}

function makeLedger(): LedgerBackend & { appended: EvidenceRecord[] } {
  const appended: EvidenceRecord[] = [];
  return {
    backendId: 'test',
    backendVersion: 'v0',
    appended,
    append: vi.fn(async (r: EvidenceRecord) => {
      appended.push(r);
    }),
    getLatestSequence: vi.fn().mockResolvedValue(0),
    getBySequence: vi.fn().mockResolvedValue(null),
    listRange: vi.fn().mockResolvedValue([]),
  };
}

function passDecision(gateId: string, order: number): GateDecision {
  return {
    gateId,
    gateOrder: order,
    plane: 'control',
    outcome: 'pass',
    reason: 'ok',
    denialCode: null,
    policyRuleId: null,
    evaluatedAt: NOW,
    durationMs: 1,
    metadata: {},
  };
}

function denyDecision(gateId: string, order: number, code: string): GateDecision {
  return {
    gateId,
    gateOrder: order,
    plane: 'control',
    outcome: 'deny',
    reason: 'denied',
    denialCode: code,
    policyRuleId: null,
    evaluatedAt: NOW,
    durationMs: 1,
    metadata: {},
  };
}

describe('Gate 07 — Evidence', () => {
  it('has gateId gate_07_evidence and gateOrder 7', async () => {
    const kp = await generateControlPlaneKeypair();
    const gate = new EvidenceGate(makeLedger(), kp);
    expect(gate.gateId).toBe('gate_07_evidence');
    expect(gate.gateOrder).toBe(7);
  });

  it('appends an EvidenceRecord to the ledger on every invocation', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    await gate.evaluate(baseAction(), makeCtx(), [
      passDecision(GATE_ID.G01, 1),
      passDecision(GATE_ID.G02, 2),
    ]);
    expect(ledger.append).toHaveBeenCalledOnce();
    expect(ledger.appended).toHaveLength(1);
  });

  it('returns finalOutcome=executed when all prior decisions are pass', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    const ctx = makeCtx();
    ctx.executionResult = {
      actionId: 'a-007',
      connectorId: 'stub',
      executedAt: NOW,
      status: 'success',
      summary: 'ok',
      payload: null,
    };
    const decisions = [
      passDecision(GATE_ID.G01, 1),
      passDecision(GATE_ID.G02, 2),
      passDecision(GATE_ID.G03, 3),
      passDecision(GATE_ID.G04, 4),
      passDecision(GATE_ID.G06, 6),
    ];
    const result = await gate.evaluate(baseAction(), ctx, decisions);
    expect(result.decision.outcome).toBe('pass');
    const record = ledger.appended[0]!;
    expect(record.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
  });

  it('returns denied_identity finalOutcome on Gate 01 denial', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    const decisions = [denyDecision(GATE_ID.G01, 1, DENIAL_CODE.ACTOR_NOT_REGISTERED)];
    await gate.evaluate(baseAction(), makeCtx(), decisions);
    const record = ledger.appended[0]!;
    expect(record.finalOutcome).toBe(FINAL_OUTCOME.DENIED_IDENTITY);
  });

  it('returns denied_delegation on Gate 03 denial (uses denialCode not reason string)', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    const decisions = [
      passDecision(GATE_ID.G01, 1),
      passDecision(GATE_ID.G02, 2),
      denyDecision(GATE_ID.G03, 3, DENIAL_CODE.DELEGATION_EXPIRED),
    ];
    await gate.evaluate(baseAction(), makeCtx(), decisions);
    const record = ledger.appended[0]!;
    expect(record.finalOutcome).toBe(FINAL_OUTCOME.DENIED_DELEGATION);
  });

  it('EvidenceRecord body contains compilerView (CCV inside body — MODULAR-009)', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    await gate.evaluate(baseAction(), makeCtx(), [passDecision(GATE_ID.G01, 1)]);
    const record = ledger.appended[0]!;
    // CCV must be inside the signed body (compilerView field on EvidenceRecord)
    expect(record.compilerView).toBeDefined();
  });

  it('EvidenceRecord has non-empty actorClass and actorEnvironment', async () => {
    const kp = await generateControlPlaneKeypair();
    const ledger = makeLedger();
    const gate = new EvidenceGate(ledger, kp);
    await gate.evaluate(baseAction(), makeCtx(), [passDecision(GATE_ID.G01, 1)]);
    const record = ledger.appended[0]!;
    expect(record.actionSummary.actorClass).toBeTruthy();
    expect(record.actionSummary.actorEnvironment).toBeTruthy();
  });
});
