/**
 * tests/e2e/_acceptance/failure.ts — the acceptance-wall truth surface.
 *
 * The owner's directive (2026-05-21): the E2E catalog is no longer
 * allowed to hide failure behind `it.skip` or `it.todo`. Every test in
 * the wall MUST run and MUST report a verdict. A test that cannot pass
 * because the surface it covers is not yet built/wired throws an
 * `AcceptanceWallFailure` with structured metadata so the reporter can
 * aggregate the failure into runs/acceptance-wall-2026-05-21/FAILURE-
 * LEDGER.{md,jsonl}.
 *
 * This is the opposite of fake-green. The wall surfaces the full mess
 * of unimplemented surfaces, missing infra, and real production bugs.
 * Repair mode (later) consumes the ledger from the top down.
 *
 * Failure-class taxonomy is owner-ratified and pinned to the alignment
 * outline's "no deferrals" stance:
 *   - UNIMPLEMENTED_TEST_BODY — the catalog slot exists, the test body
 *     was never written. Default for any conversion from `it.skip` whose
 *     scope was not classified.
 *   - HARNESS_BUG — the measurement infrastructure (harness, fixtures,
 *     transport) is broken. Fixable IN-WALL because it blocks truth.
 *   - INFRA_MISSING — Docker / target system / required local service
 *     is unavailable in this env (no Mailpit container yet, etc.).
 *   - CONNECTOR_MISSING — connector not built, not wired through admin
 *     setup, or not seeded into the user-ladder capabilities.
 *   - EXTERNAL_DEPENDENCY — Gmail OAuth, frontier model, third-party
 *     SaaS not configured. Distinct from CONNECTOR_MISSING because the
 *     external service itself is the blocker, not Nexus code.
 *   - PRODUCT_RUNTIME — Nexus runtime path is broken. Fail-closed bug,
 *     dispatch null return, gate misfire, ledger drift, etc.
 *   - LAW_VIOLATION — fail-open / wildcard authority / bypass that the
 *     no-wildcard CI gate did not catch.
 *   - SPEC_DRIFT — test/spec/code disagree on names, shapes, or
 *     contracts; the canonical statement needs ratification.
 *   - UNIMPLEMENTED_SURFACE — product feature (e.g. attachments, multi-
 *     turn chat, OCT mutation UI) is not yet built. Distinct from
 *     UNIMPLEMENTED_TEST_BODY in that the test design IS clear but the
 *     underlying surface does not exist.
 *   - FLAKE — non-deterministic timing/race; needs reproduction before
 *     classification.
 *
 * The detail is JSON-serialised into the Error message between sentinels
 * so the Vitest reporter can re-hydrate it. The sentinel format is
 * intentionally machine-parsable but human-tolerant; it survives
 * Vitest's error normalization in v3.
 */

export type FailureClass =
  | 'UNIMPLEMENTED_TEST_BODY'
  | 'HARNESS_BUG'
  | 'INFRA_MISSING'
  | 'CONNECTOR_MISSING'
  | 'EXTERNAL_DEPENDENCY'
  | 'PRODUCT_RUNTIME'
  | 'LAW_VIOLATION'
  | 'SPEC_DRIFT'
  | 'UNIMPLEMENTED_SURFACE'
  | 'FLAKE';

export type FailureOwner = 'arch' | 'audit' | 'builder' | 'owner' | 'unassigned';

export interface AcceptanceWallFailureDetail {
  /** Catalog ID, e.g. 'E2E-02', 'E2E-117A'. Literal — must match the test name. */
  readonly testId: string;
  /** Classification — drives the ledger summary and repair-mode priority. */
  readonly failureClass: FailureClass;
  /** Short specific reason. One sentence. */
  readonly reason: string;
  /** Blocker ID for the blocker graph, e.g. 'GMAIL-CONNECTOR-V1'. Optional. */
  readonly blockedBy?: string;
  /** Who needs to act. 'unassigned' is allowed but should be rare. */
  readonly owner?: FailureOwner;
  /** Hard-law / outline / spec pins this test covers. For repair-mode context. */
  readonly lawPins?: ReadonlyArray<string>;
  /** Best-guess root cause if known. Optional. */
  readonly suspectedRootCause?: string;
  /** Next concrete action to unblock. Optional. */
  readonly nextRecommendedAction?: string;
}

export const ACCEPTANCE_DETAIL_START = '<<<ACCEPTANCE_DETAIL>>>';
export const ACCEPTANCE_DETAIL_END = '<<<END_ACCEPTANCE_DETAIL>>>';

export class AcceptanceWallFailure extends Error {
  readonly detail: AcceptanceWallFailureDetail;

  constructor(detail: AcceptanceWallFailureDetail) {
    const blockedSuffix = detail.blockedBy ? ` (blockedBy=${detail.blockedBy})` : '';
    const headline = `[${detail.failureClass}] ${detail.testId}: ${detail.reason}${blockedSuffix}`;
    const json = JSON.stringify(detail);
    super(`${headline}\n${ACCEPTANCE_DETAIL_START}${json}${ACCEPTANCE_DETAIL_END}`);
    this.name = 'AcceptanceWallFailure';
    this.detail = detail;
  }
}

/**
 * Parse a structured detail back out of an error message. Returns null
 * if the message did not come from `AcceptanceWallFailure` (e.g. an
 * assertion failure from a real test body that hit a real bug — those
 * are still surfaced by the reporter, just as UNCLASSIFIED).
 */
export function parseAcceptanceDetail(message: string): AcceptanceWallFailureDetail | null {
  const i = message.indexOf(ACCEPTANCE_DETAIL_START);
  const j = message.indexOf(ACCEPTANCE_DETAIL_END);
  if (i === -1 || j === -1 || j <= i) return null;
  try {
    const raw = message.slice(i + ACCEPTANCE_DETAIL_START.length, j);
    const parsed = JSON.parse(raw) as AcceptanceWallFailureDetail;
    if (typeof parsed.testId !== 'string' || typeof parsed.failureClass !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
