/**
 * Claim drift verification helper — F4.9 §3.2 (Hard Law #14).
 *
 * Layer 2 runtime helper used by NVG (vanguard) to invoke a baked
 * ClaimVerificationPort and emit `claim_drift_detected` ledger events
 * when a re-resolved RBAC snapshot diverges from the carried snapshot
 * embedded on an NvgOutboundRequest.
 *
 * The equivalent Pipeline-flavored wrapper for NXS gates lives in
 * `packages/core/src/gates/runner.ts` (`runGateWithDriftCheck`) — it
 * shares the same `ClaimVerificationPort` contract but additionally
 * wraps a `Gate.evaluate()` call with PipelineContext semantics.
 *
 * runtime-utils boundary: imports from @nexus/contracts only.
 */
import type {
  ClaimVerificationPort,
  NonEmpty,
  RunLedgerWriter,
  RuntimeDisposition,
  Uuid,
} from '@nexus/contracts';

export interface NvgDriftWrapperDeps {
  readonly verifier: ClaimVerificationPort;
  readonly ledger: RunLedgerWriter;
  readonly disposition: RuntimeDisposition;
}

export interface NvgDriftCheckOutcome {
  readonly drift: boolean;
  readonly fieldsChanged: ReadonlyArray<string>;
  /** Human-readable explanation when drift detected; null on match. */
  readonly reason: string | null;
}

/**
 * Run the claim-drift check for an NVG site (classify-and-route or
 * return-precheck). Always writes `claim_drift_detected` to the run
 * ledger on drift (per spec §3.4 table). The caller decides whether
 * to short-circuit based on `outcome.drift` and its own disposition.
 *
 * The verifier resolver receives `actorIdentifier` (the actor whose
 * claims were minted at workspace dispatch). For NVG the actor flows
 * directly from `NvgOutboundRequest.actorId` — no Gate 01 inversion
 * required because NVG is invoked after the orch has already resolved
 * the dispatch principal.
 */
export async function runNvgGateWithDriftCheck(
  carriedClaims: Record<string, unknown>,
  actorIdentifier: Uuid,
  runId: Uuid,
  deps: NvgDriftWrapperDeps,
  gateName: NonEmpty
): Promise<NvgDriftCheckOutcome> {
  const result = await deps.verifier.verify(carriedClaims, actorIdentifier, gateName);
  if (result.kind === 'match') {
    return { drift: false, fieldsChanged: [], reason: null };
  }
  await deps.ledger.writeEvent({
    runId,
    eventType: 'claim_drift_detected',
    timestamp: new Date().toISOString() as never,
    actorId: actorIdentifier,
    detail: {
      gateName,
      principalId: actorIdentifier,
      disposition: deps.disposition,
      fieldsChanged: result.diff.fieldsChanged,
      carriedHash: result.diff.carriedHash,
      currentHash: result.diff.currentHash,
      detectedAt: result.diff.detectedAt,
    },
  });
  const reason = `claim drift detected at ${gateName} (fields: ${
    result.diff.fieldsChanged.length > 0 ? result.diff.fieldsChanged.join(', ') : '<unspecified>'
  })`;
  return { drift: true, fieldsChanged: result.diff.fieldsChanged, reason };
}
