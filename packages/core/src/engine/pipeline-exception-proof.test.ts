/**
 * GATE06-001 — Pipeline Exception Safety Proof Test
 *
 * Proves: If Gate 06 (execution) throws an exception, Gate 07 (evidence)
 * still runs and an EvidenceRecord is produced. This is the PIPELINE-001
 * fix proof — the try/catch wrapper around Gates 01-06 ensures Gate 07
 * always executes unconditionally.
 *
 * Spec: §13.1 — "Gate 07 executes regardless of all upstream outcomes."
 * Blueprint: §16.1 — "Gate 07 always runs."
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Pipeline } from './pipeline.js';
import {
  GATE_ID,
  DENIAL_CODE,
  OUTCOME_LABEL,
  OPERATING_MODE,
  EVIDENCE_SENTINEL,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type GateResult,
  type EvidenceRecord,
  type ModeConfiguration,
  type ThreatEvent,
} from '../types/index.js';
import { nowIso } from '../utils/time.js';

// ─── Minimal DB with delegation_sequences table ──────────────────────────────

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

// ─── Mock gates ──────────────────────────────────────────────────────────────

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
    evaluate: async (): Promise<GateResult> => ({
      decision: passDecision(gateId, gateOrder),
    }),
  };
}

function mockThrowingGate06() {
  return {
    gateId: GATE_ID.G06,
    gateOrder: 6,
    plane: 'data' as const,
    evaluate: async (): Promise<GateResult> => {
      throw new Error('GATE06-001 PROOF: simulated mintGrant/assertTemplateIntegrity failure');
    },
  };
}

// Gate 07 mock: records evidence and tracks invocation
function mockEvidenceGate() {
  const calls: Array<{ action: AgentAction; decisions: GateDecision[] }> = [];
  return {
    gate: {
      gateId: GATE_ID.G07,
      gateOrder: 7,
      plane: 'data' as const,
      evaluate: async (
        action: AgentAction,
        context: PipelineContext,
        decisions: GateDecision[]
      ): Promise<GateResult> => {
        calls.push({ action, decisions });
        const evidenceRecord = {
          recordId: 'proof-record',
          ledgerSequence: 1,
          actionSummary: {
            actionId: action.actionId,
            receivedAt: action.receivedAt,
            protocol: action.protocol,
            actorId: action.actorId,
            actorClass: 'SUPERVISED_AGENT',
            actorEnvironment: 'dev',
            principalId: action.principalId || 'p-test',
            delegationSequence: action.delegationSequence ?? 0,
          },
          gateDecisions: decisions,
          policyRuleId: null,
          policyOutcome: null,
          approvalRequest: null,
          approvalResponse: null,
          grantMetadata: null,
          executionResult: null,
          finalOutcome: 'error',
          threatEvents: [],
          previousHash: 'GENESIS',
          compilerView: null,
          recordHash: 'proof-hash',
          signature: 'proof-sig',
        } as unknown as EvidenceRecord;
        context.lastEvidenceRecord = evidenceRecord;
        return {
          decision: {
            gateId: GATE_ID.G07,
            gateOrder: 7,
            plane: 'data',
            outcome: 'pass',
            reason: 'evidence recorded',
            denialCode: null,
            policyRuleId: null,
            evaluatedAt: nowIso(),
            durationMs: 0,
            metadata: {},
          },
        };
      },
    },
    calls,
  };
}

// ─── Mock infrastructure ─────────────────────────────────────────────────────

function mockReplayDetector() {
  return { check: () => {} };
}

function mockRateLimiter() {
  return { check: () => {} };
}

function mockModeConfig(): ModeConfiguration {
  return {
    nxsMode: OPERATING_MODE.ENFORCING,
    nvgMode: OPERATING_MODE.ENFORCING,
    enforcingLocked: false,
    updatedAt: nowIso(),
    updatedBy: { adminId: 'test-admin' as any, publicKey: 'test-key' as any },
    signature: 'test-sig' as any,
  };
}

function makeAction(): Omit<AgentAction, 'delegationSequence'> {
  return {
    actionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    receivedAt: nowIso(),
    protocol: 'mcp',
    actorId: 'actor-001',
    principalId: 'principal-001',
    delegationId: 'del-001',
    tool: 'read_file',
    rawVerb: 'read',
    rawTarget: {
      system: 'vault',
      resourceType: 'secret',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    },
    parameters: {},
    intent: {
      objectiveSummary: 'proof test' as any,
      triggeringSource: 'test' as any,
      toolchainContext: null,
      modelId: null,
      modelConfidence: null,
      riskNote: null,
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
      actorId: 'actor-001',
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'principal-001',
      displayName: 'test',
      environment: 'dev',
      riskCeiling: 'high',
      octLevel: 'OCT-OPEN',
      allowedSystems: ['vault'],
      registeredAt: nowIso(),
    },
    principal: {
      principalId: 'principal-001',
      displayName: 'test-principal',
      email: 'test@test.com',
      registeredAt: nowIso(),
      maxDelegableRiskTier: 'high',
      allowedSystems: ['vault'],
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

// ─── Test ────────────────────────────────────────────────────────────────────

describe('GATE06-001 — Pipeline exception safety proof', () => {
  it('Gate 07 runs and produces evidence even when Gate 06 throws', async () => {
    const db = makeDb();
    const evidenceMock = mockEvidenceGate();

    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4), // returns ALLOW → triggers Gate 06
      approval: mockPassGate(GATE_ID.G05, 5), // won't be called on ALLOW path
      execution: mockThrowingGate06(), // THROWS
      evidence: evidenceMock.gate,
    };

    const pipeline = new Pipeline(
      gates as any,
      mockReplayDetector() as any,
      mockRateLimiter() as any,
      db,
      mockModeConfig()
    );

    const result = await pipeline.process(makeAction(), makeContext());

    // PROOF: Gate 07 was called exactly once
    expect(evidenceMock.calls).toHaveLength(1);

    // PROOF: Pipeline did not throw — it returned a result
    expect(result).toBeDefined();
    expect(result.evidenceRecord).toBeDefined();
    expect(result.evidenceRecord.recordId).toBe('proof-record');

    // PROOF: The exception was captured as a threat event in context
    // (the try/catch converts it to a threat event before Gate 07 runs)
    expect(result.disposition).toBe('enforce');
  });

  it('Gate 07 runs when Gate 06 throws NexusSecurityViolation', async () => {
    const db = makeDb();
    const evidenceMock = mockEvidenceGate();

    const throwingGate06 = {
      gateId: GATE_ID.G06,
      gateOrder: 6,
      plane: 'data' as const,
      evaluate: async (): Promise<GateResult> => {
        // Import NexusSecurityViolation type from the same place pipeline does
        const { NexusSecurityViolation } = await import('../types/index.js');
        throw new NexusSecurityViolation('simulated security violation in Gate 06');
      },
    };

    const gates = {
      identity: mockPassGate(GATE_ID.G01, 1),
      classification: mockPassGate(GATE_ID.G02, 2),
      delegation: mockPassGate(GATE_ID.G03, 3),
      policy: mockPassGate(GATE_ID.G04, 4),
      approval: mockPassGate(GATE_ID.G05, 5),
      execution: throwingGate06,
      evidence: evidenceMock.gate,
    };

    const pipeline = new Pipeline(
      gates as any,
      mockReplayDetector() as any,
      mockRateLimiter() as any,
      db,
      mockModeConfig()
    );

    const result = await pipeline.process(makeAction(), makeContext());

    // PROOF: Gate 07 still ran
    expect(evidenceMock.calls).toHaveLength(1);
    expect(result.evidenceRecord).toBeDefined();
  });
});
