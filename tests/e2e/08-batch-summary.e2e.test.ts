/**
 * tests/e2e/08-batch-summary.e2e.test.ts — E2E v0.4.0 §3.8
 *
 * Category 8: batch file pull + LLM summary. NXS pulls a batch, LLM
 * summarizes, compile assembles or passes through.
 *
 * Owner directive 2026-05-21: no `it.skip`. Bridge fix landed
 * 2026-05-22 (43e5ed3) so the connector-side runtime now propagates
 * executionResult; the remaining gap on this category is the LLM
 * summarize half — needs a chat-agent intersection that lets ladder
 * personas delegate (currently blocked by
 * CHAT-AGENT-LADDER-INTERSECTION-EMPTY surfaced by E2E-02..10 on
 * 2026-05-22 — default chat agent's allowedSystems=['stub'] disjoint
 * from every ladder persona's seeded systems).
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BLOCKER_CHAT_AGENT = 'CHAT-AGENT-LADDER-INTERSECTION-EMPTY';

function batchBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'UNIMPLEMENTED_SURFACE',
    reason: `Batch ${scenario} requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.`,
    blockedBy: BLOCKER_CHAT_AGENT,
    owner: 'owner',
    lawPins,
    suspectedRootCause:
      'Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.',
    nextRecommendedAction:
      "Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.",
  });
}

describe('E2E Category 8 — batch file pull + LLM summary', () => {
  it('E2E-71-batch-50-orders: analyst → 50 sales orders → one-paragraph summary', () => {
    batchBlocked('E2E-71', '50 sales-order rows', ['HL#5', 'HL#11']);
  });
  it('E2E-72-batch-100-invoices: manager → 100 invoices → top 5 anomalies', () => {
    batchBlocked('E2E-72', '100 invoices', ['HL#5', 'HL#11']);
  });
  it('E2E-73-batch-warehouse-receipts: sr_analyst → 30 days receipts → shortage forecast', () => {
    batchBlocked('E2E-73', '30 days warehouse receipts', ['HL#5', 'HL#11']);
  });
  it('E2E-74-batch-customer-tickets: sr_manager → 200 tickets → category breakdown', () => {
    batchBlocked('E2E-74', '200 customer tickets', ['HL#5', 'HL#11']);
  });
  it('E2E-75-batch-merged-files: director → sales(50)+warehouse(50) → merge → summary', () => {
    batchBlocked('E2E-75', 'sales+warehouse merge', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-76-batch-with-output-contract: vp → 100 rows → batch_summary_v1', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-76',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason: 'Requires output-contract template batch_summary_v1 AND bridge fix.',
      blockedBy: 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1',
      owner: 'arch',
      lawPins: ['HL#5', 'HL#11'],
    });
  });
  it('E2E-77-batch-classified: director → 50 confidential + 50 internal → NVG case-split', () => {
    batchBlocked('E2E-77', 'mixed-classification batch', ['HL#5', 'HL#6', 'HL#10']);
  });
  it('E2E-78-batch-with-tamper: sr_manager → 50 rows with tamper → F4.12 quarantine', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-78',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'F4.12 multi-item digest/quarantine path not built (HANDOFF §F priority #6, structurally blocked on §C.3 test-migration ratification).',
      blockedBy: 'F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH',
      owner: 'arch',
      lawPins: ['HL#11', 'F4.12'],
    });
  });
  it('E2E-79-batch-with-callback: manager → batch too large → HL #4 callback', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-79',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#4 callback when batch exceeds limits — body not written. No NXS dependency (callback fires at planner).',
      blockedBy: 'E2E-CALLBACK-FLOW',
      owner: 'builder',
      lawPins: ['HL#4'],
    });
  });
  it('E2E-80-batch-denied-by-oct: analyst → OCT-CONFIDENTIAL batch → Gate 02 denied', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-80',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'Gate 02 (OCT classification) denial — fires BEFORE bridge dispatch, testable now. Body not written.',
      blockedBy: 'E2E-OCT-SURFACE',
      owner: 'builder',
      lawPins: ['HL#5', 'HL#10'],
      nextRecommendedAction:
        'Post analyst batch run against confidential resource; assert Gate 02 denial with oct_ceiling_exceeded BEFORE any connector call.',
    });
  });
});
