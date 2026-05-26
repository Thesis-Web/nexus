/**
 * Gate 02 — Classification — unit tests
 * Spec: nexus-engineering-spec-v1-8-26.md §13.3
 * IDENTITY-002 HARDENED: context.identityClaims MUST be present. Missing = DENY.
 */

import { describe, it, expect, vi } from 'vitest';
import { ClassificationGate } from '../gates/02-classification.gate.js';
import {
  DENIAL_CODE,
  ACTION_VERB,
  ACTOR_CLASS,
  type AgentAction,
  type PipelineContext,
  type IdentityClaims,
  type RunLedgerEntry,
  type RunLedgerWriter,
} from '../types/index.js';

const NOW = new Date().toISOString();

function makeAction(verb: string, target: string): AgentAction {
  return {
    actionId: 'a-002',
    receivedAt: NOW,
    protocol: 'mcp/1.0',
    adapterVersion: 'v0.1.0',
    actorId: 'actor-001',
    principalId: 'p-001',
    sessionId: 's-001',
    delegationId: 'd-001',
    delegationSequence: 1,
    tool: 'get_record',
    rawVerb: verb,
    rawTarget: target,
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
    resolvedVerb: null,
    resolvedCapability: null,
    resolvedTarget: null,
    resolvedDataClasses: [],
    resolvedRiskTier: null,
  };
}

const DEFAULT_CLAIMS: IdentityClaims = {
  principalIdentity: 'p-001',
  roleAssignments: [],
  capabilityCeilings: [
    {
      allowedSystems: ['stub'],
      // Concrete capability set — Gate 02 tests probe OCT/risk
      // intersection, not capability membership specifically. Concrete
      // values keep the fixture honest under
      // GOV-AUTHORITY-STRICTNESS-GATE.
      allowedCapabilities: [
        'read:record:single',
        'read:record:bulk',
        'create:record:internal',
        'update:record:internal',
      ],
      maxRiskTier: 'high',
    },
  ],
  environmentContext: 'dev',
  actorClass: ACTOR_CLASS.HUMAN,
};

function makeCtx(claimsOverride?: IdentityClaims | undefined | null): PipelineContext {
  const ctx: Record<string, unknown> = {
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
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile: null,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [],
    startedAt: NOW,
  };
  // If explicitly null or undefined, do NOT set identityClaims (tests missing-claims path)
  // Otherwise set to provided or default claims
  if (claimsOverride === null) {
    // intentionally absent — tests the DENY path
  } else {
    ctx.identityClaims = claimsOverride ?? DEFAULT_CLAIMS;
  }
  return ctx as unknown as PipelineContext;
}

function makeGate(
  verbResult: string | null,
  targetResult: object | null,
  capResult: string | null,
  riskResult: string | null
) {
  const vn = { normalize: vi.fn().mockReturnValue(verbResult) };
  const tn = { normalize: vi.fn().mockReturnValue(targetResult) };
  const dc = { classify: vi.fn().mockReturnValue([]) };
  const rc = { compute: vi.fn().mockReturnValue(riskResult) };
  return {
    gate: new ClassificationGate(vn as never, tn as never, dc as never, rc as never),
    vn,
    tn,
  };
}

describe('Gate 02 — Classification', () => {
  it('passes and sets resolved fields on nominal path', async () => {
    const tgt = {
      system: 'stub',
      resourceType: 'record',
      resourceScope: 'single',
      environment: 'dev',
      externalFacing: false,
    };
    const { gate } = makeGate(ACTION_VERB.READ, tgt, 'read:record:single', 'low');
    const action = makeAction(
      'read',
      JSON.stringify({
        system: 'stub',
        resourceType: 'record',
        resourceScope: 'single',
        environment: 'ACTOR_ENVIRONMENT',
        externalFacing: false,
      })
    );
    const ctx = makeCtx();
    const result = await gate.evaluate(action, ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(result.actionMutations?.resolvedVerb).toBe(ACTION_VERB.READ);
    expect(result.actionMutations?.resolvedRiskTier).toBeDefined();
  });

  it('denies UNRESOLVABLE_VERB when verb normalizer returns null', async () => {
    const { gate } = makeGate(null, {}, 'read:record:single', 'low');
    const result = await gate.evaluate(makeAction('???', '{}'), makeCtx(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.UNRESOLVABLE_VERB);
  });

  it('denies UNRESOLVABLE_TARGET when target normalizer returns null', async () => {
    const { gate } = makeGate(ACTION_VERB.READ, null, 'read:record:single', 'low');
    const result = await gate.evaluate(makeAction('read', 'bad-target'), makeCtx(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.UNRESOLVABLE_TARGET);
  });

  it('has gateId gate_02_classification and gateOrder 2', () => {
    const { gate } = makeGate('read', {}, 'x', 'low');
    expect(gate.gateId).toBe('gate_02_classification');
    expect(gate.gateOrder).toBe(2);
  });
});

// ── IDENTITY-002 HARDENED: deny on missing claims ──────────────────────────

it('denies IDENTITY_CLAIMS_UNRESOLVABLE when identityClaims missing from context (IDENTITY-002)', async () => {
  const tgt = {
    system: 'stub',
    resourceType: 'record',
    resourceScope: 'single',
    environment: 'dev',
    externalFacing: false,
  };
  const { gate } = makeGate(ACTION_VERB.READ, tgt, 'read:record:single', 'low');
  // Pass null to makeCtx → identityClaims will be absent
  const ctx = makeCtx(null);
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.IDENTITY_CLAIMS_UNRESOLVABLE);
  expect(result.decision.reason).toContain('identity claims not present');
});

// ── OCT denial code path tests — spec §13.3, §11.1, §11.2 ────────────────

it('denies RISK_CEILING_EXCEEDED when actor is OCT-COMPILE (spec §11.2 — no system actions)', async () => {
  const tgt = {
    system: 'stub',
    resourceType: 'record',
    resourceScope: 'single',
    environment: 'dev',
    externalFacing: false,
  };
  const { gate } = makeGate(ACTION_VERB.READ, tgt, 'read:record:single', 'low');
  const ctx = makeCtx();
  ctx.actor!.octLevel = 'OCT-COMPILE';
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.RISK_CEILING_EXCEEDED);
  expect(result.decision.reason).toContain('OCT-COMPILE');
});

it('denies RISK_CEILING_EXCEEDED when risk tier exceeds OCT ceiling (spec §10.4)', async () => {
  const tgt = {
    system: 'stub',
    resourceType: 'record',
    resourceScope: 'single',
    environment: 'dev',
    externalFacing: false,
  };
  // OCT-OPEN ceiling maxRiskTier = medium; inject riskClassifier returning critical
  const { gate } = makeGate(ACTION_VERB.READ, tgt, 'read:record:single', 'critical');
  const ctx = makeCtx({
    ...DEFAULT_CLAIMS,
    capabilityCeilings: [
      {
        allowedSystems: ['stub'],
        // Concrete capability set covering the test action so the
        // identity ceiling does not block; the test is asserting risk-
        // tier denial (RISK_CEILING_EXCEEDED), not capability denial.
        allowedCapabilities: [
          'read:record:single',
          'read:record:bulk',
          'create:record:internal',
          'update:record:internal',
        ],
        maxRiskTier: 'critical', // identity ceiling doesn't block
      },
    ],
  });
  ctx.actor!.octLevel = 'OCT-OPEN';
  ctx.actor!.riskCeiling = 'critical';
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.RISK_CEILING_EXCEEDED);
});

it('denies OCT_UNASSIGNED when actor has unknown OCT level (BEST-SOLVE-D2-006)', async () => {
  const { gate } = makeGate(ACTION_VERB.READ, {}, 'read:record:single', 'low');
  const ctx = makeCtx();
  ctx.actor!.octLevel = 'OCT-NONEXISTENT';
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.OCT_UNASSIGNED);
});

// ── Phase 5 canonical surface — Gate 02 denial events ────────────────────
//
// Helper that builds a ClassificationGate with a capturing RunLedgerWriter.
// Returns the gate + the writes[] array so tests can assert the emissions.
function makeGateWithLedger(
  verbResult: string | null,
  targetResult: object | null,
  capResult: string | null,
  riskResult: string | null
): { gate: ClassificationGate; writes: RunLedgerEntry[] } {
  const vn = { normalize: vi.fn().mockReturnValue(verbResult) };
  const tn = { normalize: vi.fn().mockReturnValue(targetResult) };
  const dc = { classify: vi.fn().mockReturnValue([]) };
  const rc = { compute: vi.fn().mockReturnValue(riskResult) };
  const writes: RunLedgerEntry[] = [];
  const runLedger: RunLedgerWriter = {
    writeEvent: vi.fn(async (entry: RunLedgerEntry) => {
      writes.push(entry);
    }),
  };
  const gate = new ClassificationGate(
    vn as never,
    tn as never,
    dc as never,
    rc as never,
    runLedger
  );
  return { gate, writes };
}

it('Phase 5 — emits gate_02_oct_denied + oct_ceiling_exceeded when actor.octLevel is null', async () => {
  const { gate, writes } = makeGateWithLedger(ACTION_VERB.READ, {}, 'read:record:single', 'low');
  const ctx = makeCtx();
  ctx.actor!.octLevel = null;
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.OCT_UNASSIGNED);
  const octEvents = writes.filter(e => e.eventType === 'gate_02_oct_denied');
  const ceilingEvents = writes.filter(e => e.eventType === 'oct_ceiling_exceeded');
  expect(octEvents.length).toBe(1);
  expect(ceilingEvents.length).toBe(1);
  expect(octEvents[0]!.detail['reason']).toBe('oct_unassigned');
});

it('Phase 5 — emits gate_02_oct_denied + oct_ceiling_exceeded when OCT-COMPILE blocks system actions', async () => {
  const tgt = {
    system: 'stub',
    resourceType: 'record',
    resourceScope: 'single',
    environment: 'dev',
    externalFacing: false,
  };
  const { gate, writes } = makeGateWithLedger(ACTION_VERB.READ, tgt, 'read:record:single', 'low');
  const ctx = makeCtx();
  ctx.actor!.octLevel = 'OCT-COMPILE';
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  // Internal denial code is RISK_CEILING_EXCEEDED but the audit surface
  // names the axis at fault: OCT (OCT-COMPILE class forbids actions).
  expect(result.decision.denialCode).toBe(DENIAL_CODE.RISK_CEILING_EXCEEDED);
  expect(writes.filter(e => e.eventType === 'gate_02_oct_denied').length).toBe(1);
  expect(writes.filter(e => e.eventType === 'oct_ceiling_exceeded').length).toBe(1);
});

it('Phase 5 — emits gate_02_risk_denied + risk_ceiling_exceeded when risk tier exceeds effective ceiling', async () => {
  const tgt = {
    system: 'stub',
    resourceType: 'record',
    resourceScope: 'single',
    environment: 'dev',
    externalFacing: false,
  };
  // OCT-OPEN ceiling maxRiskTier = medium; riskClassifier returns critical
  const { gate, writes } = makeGateWithLedger(
    ACTION_VERB.READ,
    tgt,
    'read:record:single',
    'critical'
  );
  const ctx = makeCtx({
    actorId: 'actor-001',
    capabilityCeilings: [
      {
        allowedSystems: ['stub'],
        allowedCapabilities: [
          'read:record:single',
          'read:record:bulk',
          'create:record:internal',
          'update:record:internal',
        ],
        maxRiskTier: 'critical',
      },
    ],
  });
  ctx.actor!.octLevel = 'OCT-OPEN';
  ctx.actor!.riskCeiling = 'critical';
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.RISK_CEILING_EXCEEDED);
  const riskEvents = writes.filter(e => e.eventType === 'gate_02_risk_denied');
  const ceilingEvents = writes.filter(e => e.eventType === 'risk_ceiling_exceeded');
  expect(riskEvents.length).toBe(1);
  expect(ceilingEvents.length).toBe(1);
  expect(riskEvents[0]!.detail['riskTier']).toBe('critical');
  expect(riskEvents[0]!.detail['effectiveCeiling']).toBe('medium');
});

it('Phase 5 — does NOT emit any gate_02 event when no runLedger is wired (backward-compat)', async () => {
  // Plain makeGate() constructs without a ledger. Existing tests rely
  // on this constructor staying side-effect-free.
  const { gate } = makeGate(ACTION_VERB.READ, {}, 'read:record:single', 'low');
  const ctx = makeCtx();
  ctx.actor!.octLevel = null;
  const result = await gate.evaluate(makeAction('read', '{}'), ctx, []);
  expect(result.decision.outcome).toBe('deny');
  expect(result.decision.denialCode).toBe(DENIAL_CODE.OCT_UNASSIGNED);
  // The decision shape is unchanged from the prior test of the same path.
});
