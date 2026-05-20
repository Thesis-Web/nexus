/**
 * F4.9 CDV-02 / CDV-03 / CDV-05 / CDV-06 integration tests — Pipeline +
 * claim-drift wrapper end-to-end.
 *
 * Each scenario boots a minimal Pipeline with mocked gates and a
 * controllable ClaimVerificationPort. The verifier toggles between
 * 'match' and 'drift' between gates to exercise the mode matrix from
 * spec §3.4. The wrapper writes `claim_drift_detected` to a captured
 * ledger; the integration test asserts the resulting GateDecision +
 * ledger emission together.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { Pipeline } from './pipeline.js';
import {
  GATE_ID,
  DENIAL_CODE,
  OUTCOME_LABEL,
  OPERATING_MODE,
  type AgentAction,
  type ClaimVerificationPort,
  type ClaimVerificationResult,
  type GateDecision,
  type GateResult,
  type ModeConfiguration,
  type PipelineContext,
  type RunLedgerEntry,
  type RunLedgerWriter,
  type ThreatEvent,
} from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { FINAL_OUTCOME } from '@nexus/contracts';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegation_sequences (
      delegation_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function passDecision(gateId: string, gateOrder: number): GateDecision {
  return {
    gateId,
    gateOrder,
    plane: 'control',
    outcome: gateOrder === 4 ? OUTCOME_LABEL.ALLOW : ('pass' as any),
    reason: 'mock pass',
    denialCode: null,
    policyRuleId: null,
    evaluatedAt: nowIso(),
    durationMs: 0,
    metadata: {},
  };
}

function mockPassGate(gateId: string, gateOrder: number) {
  return {
    gateId,
    gateOrder,
    plane: 'control' as const,
    evaluate: async (): Promise<GateResult> => ({ decision: passDecision(gateId, gateOrder) }),
  };
}

function mockEvidenceGate() {
  return {
    gateId: GATE_ID.G07,
    gateOrder: 7,
    plane: 'data' as const,
    evaluate: async (
      action: AgentAction,
      context: PipelineContext,
      decisions: GateDecision[]
    ): Promise<GateResult> => {
      const record = {
        recordId: 'cdv-record',
        ledgerSequence: 1,
        actionSummary: {
          actionId: action.actionId,
          receivedAt: action.receivedAt,
          protocol: action.protocol,
          actorId: action.actorId,
          actorClass: 'SUPERVISED_AGENT',
          actorEnvironment: 'dev',
          principalId: action.principalId || 'principal-1',
          delegationSequence: action.delegationSequence ?? 0,
        },
        gateDecisions: decisions,
        policyRuleId: null,
        policyOutcome: null,
        approvalRequest: null,
        approvalResponse: null,
        grantMetadata: null,
        executionResult: null,
        finalOutcome: FINAL_OUTCOME.DENIED_CLAIM_DRIFT,
        threatEvents: [],
        previousHash: 'GENESIS',
        compilerView: null,
        recordHash: 'cdv-hash',
        signature: 'cdv-sig',
      } as any;
      context.lastEvidenceRecord = record;
      return { decision: passDecision(GATE_ID.G07, 7) };
    },
  };
}

function makeReplayDetector() {
  return { check: () => {} };
}
function makeRateLimiter() {
  return { check: () => {} };
}

function makeModeConfig(mode: 'enforcing' | 'observe' | 'advisory'): ModeConfiguration {
  const nxsMode =
    mode === 'enforcing'
      ? OPERATING_MODE.ENFORCING
      : mode === 'observe'
        ? OPERATING_MODE.OBSERVE
        : OPERATING_MODE.ADVISORY;
  return {
    nxsMode,
    nvgMode: OPERATING_MODE.ENFORCING,
    enforcingLocked: false,
    updatedAt: nowIso(),
    updatedBy: { adminId: 'cdv-admin' as any, publicKey: 'cdv-key' as any },
    signature: 'cdv-sig' as any,
  };
}

function makeAction(): Omit<AgentAction, 'delegationSequence'> {
  return {
    actionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    runId: 'cccccccc-cccc-cccc-cccc-cccccccccddd',
    receivedAt: nowIso(),
    protocol: 'cdv',
    adapterVersion: 'cdv-test-v1',
    actorId: 'actor-1',
    principalId: 'principal-1',
    sessionId: 'session-cdv',
    delegationId: 'd-1',
    tool: 'read_file',
    rawVerb: 'read',
    rawTarget: 'vault.secret',
    rawPayload: null,
    intent: {
      objectiveSummary: 'cdv test' as any,
      triggeringSource: 'mcp' as any,
      toolchainContext: 'cdv-toolchain',
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: nowIso(),
    },
    resolvedVerb: 'read',
    resolvedCapability: 'read:record:single',
    resolvedTarget: {
      system: 'vault',
      resourceType: 'secret',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    },
    resolvedDataClasses: [],
    resolvedRiskTier: 'low',
  } as any;
}

function makeContext(): PipelineContext {
  return {
    actor: {
      actorId: 'actor-1',
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'principal-1',
      displayName: 'cdv',
      environment: 'dev',
      riskCeiling: 'high',
      octLevel: 'OCT-OPEN',
      allowedSystems: ['vault'],
      registeredAt: nowIso(),
    },
    principal: {
      principalId: 'principal-1',
      displayName: 'cdv-principal',
      email: 'cdv@test.com',
      registeredAt: nowIso(),
      maxDelegableRiskTier: 'high',
      allowedSystems: ['vault'],
    },
    identityClaims: {
      principalIdentity: 'principal-1',
      roleAssignments: ['analyst'],
      capabilityCeilings: [
        {
          allowedSystems: ['vault'],
          allowedCapabilities: ['read:record:single'],
          maxRiskTier: 'high',
        },
      ],
      environmentContext: 'dev',
      actorClass: 'SUPERVISED_AGENT',
    },
    delegationContext: null,
    delegationStore: {
      getById: async () => null,
      save: async () => {},
      listForActor: async () => [],
    },
    delegationSnapshot: null,
    grantTemplate: null,
    approvalRequest: null,
    approvalResponse: null,
    executionGrant: null,
    executionResult: null,
    threatLog: [] as ThreatEvent[],
    connectorRegistry: { get: () => undefined, register: () => {}, list: () => [] },
    channelRegistry: { get: () => undefined, register: () => {}, list: () => [] },
    approverRegistry: { getPublicKey: async () => null, list: async () => [] },
  } as unknown as PipelineContext;
}

/**
 * Verifier that switches outcomes based on the gate name it receives.
 * Lets each test wire which gate(s) see drift while others see match.
 */
function makeDriftAtVerifier(
  driftAt: ReadonlySet<string>,
  fieldsChanged: ReadonlyArray<string>
): ClaimVerificationPort {
  return {
    verify: async (_carried, _principalId, gateName): Promise<ClaimVerificationResult> => {
      if (driftAt.has(gateName)) {
        return {
          kind: 'drift',
          currentClaimsHash: 'cdv-current' as any,
          diff: {
            principalId: 'actor-1' as any,
            fieldsChanged,
            carriedHash: 'cdv-carried' as any,
            currentHash: 'cdv-current' as any,
            detectedAt: nowIso(),
          },
        };
      }
      return { kind: 'match', currentClaimsHash: 'cdv-match' as any };
    },
  };
}

function makeCapturedLedger(): {
  writer: RunLedgerWriter;
  entries: RunLedgerEntry[];
} {
  const entries: RunLedgerEntry[] = [];
  return {
    entries,
    writer: {
      writeEvent: async entry => {
        entries.push({ ...entry, entryId: `evt-${entries.length}` as any } as RunLedgerEntry);
      },
      getByRunId: async () => entries,
      tail: async () => entries,
      getLatestRunId: async () => null,
    },
  };
}

describe('F4.9 claim drift — Pipeline integration', () => {
  it('CDV-02: capability removed between Gate 01 and Gate 04 → Gate 04 deny', async () => {
    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4),
      approval: mockPassGate(GATE_ID.G05, 5),
      execution: mockPassGate(GATE_ID.G06, 6),
      evidence: mockEvidenceGate(),
    };
    const ledger = makeCapturedLedger();
    const verifier = makeDriftAtVerifier(new Set([GATE_ID.G04]), ['capabilities']);
    const pipeline = new Pipeline(
      gates as any,
      makeReplayDetector() as any,
      makeRateLimiter() as any,
      makeDb(),
      makeModeConfig('enforcing'),
      { verifier, runLedger: ledger.writer }
    );

    const result = await pipeline.process(makeAction(), makeContext());

    // Gate 04 should appear with a deny decision; the deny denialCode is the F4.9 marker.
    const gate04Decision = result.evidenceRecord.gateDecisions.find(d => d.gateId === GATE_ID.G04);
    expect(gate04Decision?.outcome).toBe('deny');
    expect(gate04Decision?.denialCode).toBe(DENIAL_CODE.CLAIM_DRIFT_DETECTED);
    const driftWrite = ledger.entries.find(e => e.eventType === 'claim_drift_detected');
    expect(driftWrite).toBeDefined();
    const detail = driftWrite!.detail as Record<string, unknown>;
    expect(detail['gateName']).toBe(GATE_ID.G04);
    expect(detail['fieldsChanged']).toEqual(['capabilities']);
  });

  it('CDV-03: OCT raised between Gate 02 and Gate 05 → drift at Gate 04+ (linear scan stops at first drift)', async () => {
    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4),
      approval: mockPassGate(GATE_ID.G05, 5),
      execution: mockPassGate(GATE_ID.G06, 6),
      evidence: mockEvidenceGate(),
    };
    const ledger = makeCapturedLedger();
    const verifier = makeDriftAtVerifier(new Set([GATE_ID.G04, GATE_ID.G05]), ['octLevel']);
    const pipeline = new Pipeline(
      gates as any,
      makeReplayDetector() as any,
      makeRateLimiter() as any,
      makeDb(),
      makeModeConfig('enforcing'),
      { verifier, runLedger: ledger.writer }
    );
    const result = await pipeline.process(makeAction(), makeContext());
    const denyDecision = result.evidenceRecord.gateDecisions.find(
      d => d.denialCode === DENIAL_CODE.CLAIM_DRIFT_DETECTED
    );
    expect(denyDecision?.gateId).toBe(GATE_ID.G04);
    const driftWrites = ledger.entries.filter(e => e.eventType === 'claim_drift_detected');
    expect(driftWrites.length).toBeGreaterThan(0);
    expect((driftWrites[0]!.detail as Record<string, unknown>)['fieldsChanged']).toEqual([
      'octLevel',
    ]);
  });

  it('CDV-05: observe mode — drift logs claim_drift_detected, gate evaluation proceeds', async () => {
    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4),
      approval: mockPassGate(GATE_ID.G05, 5),
      execution: mockPassGate(GATE_ID.G06, 6),
      evidence: mockEvidenceGate(),
    };
    const ledger = makeCapturedLedger();
    const verifier = makeDriftAtVerifier(new Set([GATE_ID.G02, GATE_ID.G03]), ['capabilities']);
    const pipeline = new Pipeline(
      gates as any,
      makeReplayDetector() as any,
      makeRateLimiter() as any,
      makeDb(),
      makeModeConfig('observe'),
      { verifier, runLedger: ledger.writer }
    );
    const result = await pipeline.process(makeAction(), makeContext());
    // Observe mode: every gate decision should be 'pass' (no drift-deny).
    const denies = result.evidenceRecord.gateDecisions.filter(
      d => d.denialCode === DENIAL_CODE.CLAIM_DRIFT_DETECTED
    );
    expect(denies).toHaveLength(0);
    // But the ledger should still capture the drift events (spec §3.4
    // "ledger writes always").
    const driftWrites = ledger.entries.filter(e => e.eventType === 'claim_drift_detected');
    expect(driftWrites.length).toBeGreaterThan(0);
    expect((driftWrites[0]!.detail as Record<string, unknown>)['disposition']).toBe('observe');
  });

  it('CDV-06: enforce mode — drift denies, run terminates, ledger captures the drift', async () => {
    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4),
      approval: mockPassGate(GATE_ID.G05, 5),
      execution: mockPassGate(GATE_ID.G06, 6),
      evidence: mockEvidenceGate(),
    };
    const ledger = makeCapturedLedger();
    const verifier = makeDriftAtVerifier(new Set([GATE_ID.G02]), ['capabilities', 'octLevel']);
    const pipeline = new Pipeline(
      gates as any,
      makeReplayDetector() as any,
      makeRateLimiter() as any,
      makeDb(),
      makeModeConfig('enforcing'),
      { verifier, runLedger: ledger.writer }
    );
    const result = await pipeline.process(makeAction(), makeContext());
    const driftDecision = result.evidenceRecord.gateDecisions.find(
      d => d.denialCode === DENIAL_CODE.CLAIM_DRIFT_DETECTED
    );
    expect(driftDecision?.gateId).toBe(GATE_ID.G02);
    // Downstream gates 03-06 must NOT have run after the deny.
    expect(result.evidenceRecord.gateDecisions.some(d => d.gateId === GATE_ID.G03)).toBe(false);
    expect(result.evidenceRecord.gateDecisions.some(d => d.gateId === GATE_ID.G05)).toBe(false);
    // Gate 07 (Evidence) still wrote — see mockEvidenceGate.
    expect(result.evidenceRecord.gateDecisions.some(d => d.gateId === GATE_ID.G07)).toBe(true);
    const driftWrite = ledger.entries.find(e => e.eventType === 'claim_drift_detected');
    expect(driftWrite).toBeDefined();
    expect((driftWrite!.detail as Record<string, unknown>)['fieldsChanged']).toEqual([
      'capabilities',
      'octLevel',
    ]);
  });
});
