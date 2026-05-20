/**
 * runGateWithDriftCheck — F4.9 §3 unit tests.
 *
 * Covers the wrapper's mode matrix (§3.4):
 *   enforce  → drift returns deny + writes ledger event
 *   observe  → drift logs + proceeds to evaluate
 *   advisory → drift logs + proceeds to evaluate
 *
 * Plus the Gate 01 bypass (§3.1) and the missing-claims invariant.
 */
import { describe, it, expect } from 'vitest';
import {
  DENIAL_CODE,
  GATE_ID,
  type ClaimVerificationPort,
  type ClaimVerificationResult,
  type Gate,
  type GateDecision,
  type GateResult,
  type RunLedgerWriter,
} from '@nexus/contracts';
import { runGateWithDriftCheck, type DriftWrapperDeps } from './runner.js';

function makeAction(): any {
  return {
    actionId: 'a-1',
    runId: '00000000-0000-0000-0000-000000000aaa',
    actorId: 'actor-1',
    principalId: 'principal-1',
    sessionId: 's-1',
    delegationId: 'd-1',
    delegationSequence: 1,
  };
}

function makeContext(overrides: any = {}): any {
  return {
    actor: { actorId: 'actor-1' },
    principal: { principalId: 'principal-1' },
    identityClaims: {
      principalIdentity: 'principal-1',
      roleAssignments: [],
      capabilityCeilings: [],
      environmentContext: 'dev',
      actorClass: 'SUPERVISED_AGENT',
    },
    threatLog: [],
    ...overrides,
  };
}

function makeGate(gateId: string, order: number, plane: 'control' | 'data' = 'control'): Gate {
  return {
    gateId,
    gateOrder: order,
    plane,
    evaluate: async (): Promise<GateResult> => ({
      decision: {
        gateId,
        gateOrder: order,
        plane,
        outcome: 'pass',
        reason: 'mock pass',
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString() as any,
        durationMs: 0,
        metadata: {},
      },
    }),
  };
}

interface CapturedLedger {
  writes: Array<Record<string, unknown>>;
  writer: RunLedgerWriter;
}

function makeCapturedLedger(): CapturedLedger {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    writer: {
      writeEvent: async entry => {
        writes.push(entry as unknown as Record<string, unknown>);
      },
      getByRunId: async () => [],
      tail: async () => [],
      getLatestRunId: async () => null,
    },
  };
}

function makeVerifier(result: ClaimVerificationResult): ClaimVerificationPort {
  return { verify: async () => result };
}

const matchResult: ClaimVerificationResult = {
  kind: 'match',
  currentClaimsHash: 'match-hash' as any,
};

const driftResult: ClaimVerificationResult = {
  kind: 'drift',
  currentClaimsHash: 'current-hash' as any,
  diff: {
    principalId: 'actor-1' as any,
    fieldsChanged: ['capabilities', 'octLevel'],
    carriedHash: 'carried-hash' as any,
    currentHash: 'current-hash' as any,
    detectedAt: new Date().toISOString() as any,
  },
};

describe('runGateWithDriftCheck (F4.9 §3)', () => {
  it('Gate 01 bypass — wrapper does not call verifier; evaluate runs', async () => {
    const gate = makeGate(GATE_ID.G01, 1);
    const ledger = makeCapturedLedger();
    let verifierCalls = 0;
    const verifier: ClaimVerificationPort = {
      verify: async () => {
        verifierCalls++;
        return matchResult;
      },
    };
    const deps: DriftWrapperDeps = {
      verifier,
      ledger: ledger.writer,
      disposition: 'enforce',
    };
    const result = await runGateWithDriftCheck(
      gate,
      makeAction(),
      makeContext(),
      [],
      deps,
      GATE_ID.G01 as any
    );
    expect(verifierCalls).toBe(0);
    expect(result.decision.outcome).toBe('pass');
    expect(ledger.writes).toHaveLength(0);
  });

  it('match → wrapper calls gate.evaluate, no ledger writes', async () => {
    const gate = makeGate(GATE_ID.G02, 2);
    const ledger = makeCapturedLedger();
    const deps: DriftWrapperDeps = {
      verifier: makeVerifier(matchResult),
      ledger: ledger.writer,
      disposition: 'enforce',
    };
    const result = await runGateWithDriftCheck(
      gate,
      makeAction(),
      makeContext(),
      [],
      deps,
      GATE_ID.G02 as any
    );
    expect(result.decision.outcome).toBe('pass');
    expect(ledger.writes).toHaveLength(0);
  });

  it('drift + enforce → deny GateResult + claim_drift_detected ledger event', async () => {
    const gate = makeGate(GATE_ID.G04, 4);
    const ledger = makeCapturedLedger();
    let evalCalls = 0;
    const origEvaluate = gate.evaluate.bind(gate);
    gate.evaluate = async (...args) => {
      evalCalls++;
      return origEvaluate(...args);
    };
    const deps: DriftWrapperDeps = {
      verifier: makeVerifier(driftResult),
      ledger: ledger.writer,
      disposition: 'enforce',
    };
    const result = await runGateWithDriftCheck(
      gate,
      makeAction(),
      makeContext(),
      [],
      deps,
      GATE_ID.G04 as any
    );
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CLAIM_DRIFT_DETECTED);
    expect(evalCalls).toBe(0); // gate.evaluate must NOT run on enforce-mode drift
    expect(ledger.writes).toHaveLength(1);
    const evt = ledger.writes[0]!;
    expect(evt['eventType']).toBe('claim_drift_detected');
    const detail = evt['detail'] as Record<string, unknown>;
    expect(detail['gateName']).toBe(GATE_ID.G04);
    expect(detail['disposition']).toBe('enforce');
    expect(detail['fieldsChanged']).toEqual(['capabilities', 'octLevel']);
    expect(result.decision.metadata!['claimDriftFieldsChanged']).toBe('capabilities,octLevel');
    expect(result.decision.metadata!['claimDriftFieldCount']).toBe(2);
  });

  it('drift + observe → ledger event written, gate.evaluate proceeds', async () => {
    const gate = makeGate(GATE_ID.G03, 3);
    const ledger = makeCapturedLedger();
    let evalCalls = 0;
    const origEvaluate = gate.evaluate.bind(gate);
    gate.evaluate = async (...args) => {
      evalCalls++;
      return origEvaluate(...args);
    };
    const deps: DriftWrapperDeps = {
      verifier: makeVerifier(driftResult),
      ledger: ledger.writer,
      disposition: 'observe',
    };
    const result = await runGateWithDriftCheck(
      gate,
      makeAction(),
      makeContext(),
      [],
      deps,
      GATE_ID.G03 as any
    );
    expect(result.decision.outcome).toBe('pass');
    expect(evalCalls).toBe(1);
    expect(ledger.writes).toHaveLength(1);
    expect((ledger.writes[0]!['detail'] as Record<string, unknown>)['disposition']).toBe('observe');
  });

  it('drift + advisory → ledger event written, gate.evaluate proceeds', async () => {
    const gate = makeGate(GATE_ID.G03, 3);
    const ledger = makeCapturedLedger();
    const deps: DriftWrapperDeps = {
      verifier: makeVerifier(driftResult),
      ledger: ledger.writer,
      disposition: 'advisory',
    };
    const result = await runGateWithDriftCheck(
      gate,
      makeAction(),
      makeContext(),
      [],
      deps,
      GATE_ID.G03 as any
    );
    expect(result.decision.outcome).toBe('pass');
    expect(ledger.writes).toHaveLength(1);
    expect((ledger.writes[0]!['detail'] as Record<string, unknown>)['disposition']).toBe(
      'advisory'
    );
  });

  it('missing identityClaims invariant — throws composition-bug error', async () => {
    const gate = makeGate(GATE_ID.G02, 2);
    const ledger = makeCapturedLedger();
    const deps: DriftWrapperDeps = {
      verifier: makeVerifier(matchResult),
      ledger: ledger.writer,
      disposition: 'enforce',
    };
    const ctx = makeContext({ identityClaims: undefined });
    await expect(
      runGateWithDriftCheck(gate, makeAction(), ctx, [], deps, GATE_ID.G02 as any)
    ).rejects.toThrow(/identityClaims absent/);
  });
});
