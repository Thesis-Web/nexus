/**
 * runGateWithDriftCheck — F4.9 §3.1 (Hard Law #14)
 *
 * Wraps a NXS gate's `evaluate()` call with a Claim Verification port
 * callback. Re-resolves the principal's RBAC claims, canonicalizes the
 * carried snapshot, compares SHA-256 hashes. Drift fails the gate
 * closed in enforce mode (after writing `claim_drift_detected` to the
 * run ledger); observe/advisory log and proceed.
 *
 * Gate 01 (identity resolution) is the canonical resolver of
 * `context.identityClaims`. Wrapping Gate 01 would compare a snapshot
 * against itself in the very same call, which is meaningless.
 * `runGateWithDriftCheck` therefore bypasses verification when
 * `gate.gateOrder === 1` and forwards to evaluate() directly.
 *
 * The wrapper does NOT depend on Pipeline composition state. It takes
 * the verifier + ledger + disposition as inputs so the same helper can
 * be reused at NVG gates (classify-and-route, return-precheck) from
 * Layer 3.
 *
 * Layer 1 — imports from Layer 2 (@nexus/contracts) only.
 * Spec: docs/blueprints/AMEND-nexus-claim-drift-verification-v0-1-0.md
 *       §2.1, §2.2, §3.1, §3.4, §3.5
 * Outline: §1 Hard Law #14; §3 G NVG; §3 H NXS.
 */
import {
  DENIAL_CODE,
  GATE_ID,
  type AgentAction,
  type ClaimVerificationPort,
  type Gate,
  type GateDecision,
  type GateResult,
  type IsoTimestamp,
  type NonEmpty,
  type PipelineContext,
  type RunLedgerWriter,
  type RuntimeDisposition,
} from '../types/index.js';

/**
 * Identifier the wrapper uses when calling the verifier and writing the
 * `claim_drift_detected` ledger event. NXS gates emit their GATE_ID
 * value; NVG sites emit a semantic name (`nvg_classify_and_route`,
 * `nvg_return_precheck`). Stored verbatim in the event detail so audit
 * can reconstruct where the drift was caught.
 */
export type DriftGateName = NonEmpty;

export interface DriftWrapperDeps {
  readonly verifier: ClaimVerificationPort;
  readonly ledger: RunLedgerWriter;
  readonly disposition: RuntimeDisposition;
}

/**
 * Wrap a NXS gate with the claim-drift check. Gate 01 short-circuits
 * (it IS the resolver). For all other gates, the wrapper calls the
 * verifier with the carried claims envelope (`context.identityClaims`),
 * keyed on the actor identifier resolved at Gate 01.
 *
 * Mode behavior (spec §3.4):
 * - enforce  → drift writes ledger event + returns deny GateResult
 * - advisory → drift writes ledger event + proceeds to evaluate()
 * - observe  → drift writes ledger event + proceeds to evaluate()
 *
 * Ledger writes happen in every mode (spec §3.4 table column).
 */
export async function runGateWithDriftCheck(
  gate: Gate,
  action: AgentAction,
  context: PipelineContext,
  priorDecisions: GateDecision[],
  deps: DriftWrapperDeps,
  gateName: DriftGateName
): Promise<GateResult> {
  // Gate 01 IS the resolver — verifying against itself is meaningless.
  if (gate.gateOrder === 1 || gate.gateId === GATE_ID.G01) {
    return gate.evaluate(action, context, priorDecisions);
  }

  // The wrapper relies on Gate 01 having populated identityClaims.
  // Pipeline composition guarantees the order; a missing claims envelope
  // here means the caller wired the wrapper around a gate that runs
  // before Gate 01 — a composition bug, not a runtime user error.
  const carried = context.identityClaims;
  if (!carried) {
    throw new Error(
      `runGateWithDriftCheck: context.identityClaims absent at gate=${gateName} ` +
        '(Gate 01 must run before any wrapped gate)'
    );
  }

  const carriedRecord = carried as unknown as Record<string, unknown>;
  // F4.9 §2.1: the verifier signature takes (carriedClaims, principalId,
  // gateName). For NXS pipeline gates the lookup identifier passed to
  // the resolver is the actor whose claims Gate 01 resolved
  // (`context.actor.actorId`), so production resolvers can call back
  // through IdentityProvider.resolveIdentity which is keyed on actor
  // identifier. Gate 01 guarantees `context.actor` is populated
  // whenever `context.identityClaims` is populated.
  const principalId = context.actor.actorId;

  const result = await deps.verifier.verify(carriedRecord, principalId, gateName);

  if (result.kind === 'match') {
    return gate.evaluate(action, context, priorDecisions);
  }

  // ── Drift detected ──────────────────────────────────────────────────
  // Always write the ledger event. Detail carries the diff + carried hash
  // + current hash + the disposition that decided the response — never
  // the claim values themselves (spec §3.3).
  await deps.ledger.writeEvent({
    runId: action.runId,
    eventType: 'claim_drift_detected',
    timestamp: new Date().toISOString() as IsoTimestamp,
    actorId: action.actorId,
    detail: {
      gateName,
      principalId,
      disposition: deps.disposition,
      fieldsChanged: result.diff.fieldsChanged,
      carriedHash: result.diff.carriedHash,
      currentHash: result.diff.currentHash,
      detectedAt: result.diff.detectedAt,
    },
  });

  if (deps.disposition === 'enforce') {
    return driftDeny(gate, gateName, result.diff.fieldsChanged);
  }

  // observe / advisory: log and proceed with the carried snapshot
  // (spec §3.4 — "gate evaluation proceeds with carried").
  return gate.evaluate(action, context, priorDecisions);
}

function driftDeny(
  gate: Gate,
  gateName: DriftGateName,
  fieldsChanged: ReadonlyArray<string>
): GateResult {
  const decision: GateDecision = {
    gateId: gate.gateId,
    gateOrder: gate.gateOrder,
    plane: gate.plane,
    outcome: 'deny',
    reason: `claim drift detected at ${gateName} (fields: ${
      fieldsChanged.length > 0 ? fieldsChanged.join(', ') : '<unspecified>'
    })`,
    denialCode: DENIAL_CODE.CLAIM_DRIFT_DETECTED,
    policyRuleId: null,
    evaluatedAt: new Date().toISOString() as IsoTimestamp,
    durationMs: 0,
    metadata: {
      // GateDecision.metadata values must be scalar; join the field list so
      // downstream evidence renderers can read it without parsing JSON.
      claimDriftFieldsChanged: fieldsChanged.join(','),
      claimDriftFieldCount: fieldsChanged.length,
    },
  };
  return { decision };
}

// NVG callers reach for `runNvgGateWithDriftCheck` from
// @nexus/runtime-utils — the helper lives there because vanguard cannot
// import @nexus/core (Layer 3 → Layer 1 is forbidden). The Pipeline
// wrapper above is the NXS-side counterpart that wraps Gate.evaluate()
// with PipelineContext semantics.
