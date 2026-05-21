/**
 * tests/e2e/06-mixed-tier.e2e.test.ts — E2E v0.4.0 §3.6
 *
 * Category 6: multi-agent mixed on-prem + frontier. NVG routes per
 * node, mailbox carries between turns.
 *
 * Owner directive 2026-05-21: no `it.skip`. All mixed-tier scenarios
 * include a frontier hop, so they block on the frontier-fixture
 * adapter (Category 2 blocker), plus the multi-agent DAG harness work
 * from Category 4.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BLOCKER = 'FRONTIER-LIVE-OR-FIXTURE-V1';

function mixedBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'EXTERNAL_DEPENDENCY',
    reason: `Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: ${scenario}.`,
    blockedBy: BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.',
  });
}

describe('E2E Category 6 — multi-agent MIXED on-prem + frontier', () => {
  it('E2E-51-onprem-then-frontier: sr_analyst → summarize → elaborate', () => {
    mixedBlocked('E2E-51', 'sr_analyst on-prem summarize → frontier elaborate', ['HL#6', 'HL#11']);
  });
  it('E2E-52-frontier-then-onprem: sr_manager → research → summarize', () => {
    mixedBlocked('E2E-52', 'sr_manager frontier research → on-prem summarize', ['HL#6', 'HL#11']);
  });
  it('E2E-53-mixed-parallel: manager → onprem-A + frontier-B → judge', () => {
    mixedBlocked('E2E-53', 'manager parallel on-prem + frontier → judge', ['HL#6', 'HL#11']);
  });
  it('E2E-54-3-stage-mixed: director → onprem → frontier → onprem-format', () => {
    mixedBlocked('E2E-54', 'director 3-stage mixed pipeline', ['HL#6', 'HL#11']);
  });
  it('E2E-55-mixed-with-nxs: sr_manager → nxs-pull → onprem-summarize → frontier-polish', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-55',
      failureClass: 'PRODUCT_RUNTIME',
      reason:
        'NXS dispatch bridge returns null (see E2E-23). Mixed-tier-with-NXS depends on NXS pull working first.',
      blockedBy: 'NXS-DISPATCH-BRIDGE-RETURNS-NULL',
      owner: 'arch',
      lawPins: ['HL#5', 'HL#6', 'HL#11'],
      nextRecommendedAction: 'Fix NXS dispatch bridge then build out this scenario.',
    });
  });
  it('E2E-56-mixed-with-output-contract: vp → board doc with frontier research', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-56',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Requires both frontier-fixture (Category 2 blocker) AND output-contract templates (Category 5 blocker).',
      blockedBy: 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1',
      owner: 'arch',
      lawPins: ['HL#6', 'HL#11'],
    });
  });
  it('E2E-57-mixed-translation-pair: vp → onprem-en-fr + frontier-en-zh', () => {
    mixedBlocked('E2E-57', 'vp parallel on-prem + frontier translations', ['HL#6', 'HL#11']);
  });
  it('E2E-58-mixed-cost-routing-check: executive → low-cost on-prem + high-cost frontier', () => {
    mixedBlocked('E2E-58', 'executive cost-aware routing check', ['HL#6', 'HL#11']);
  });
  it('E2E-59-mixed-fallback: director → frontier unhealthy → on-prem fallback', () => {
    mixedBlocked('E2E-59', 'director frontier-fallback', ['HL#6']);
  });
  it('E2E-60-mixed-denied-by-tier-ceiling: analyst → frontier denied at NVG', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-60',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'NVG tier-ceiling denial path is testable WITHOUT a frontier adapter — the denial fires BEFORE the adapter call. Body not yet written.',
      blockedBy: 'E2E-MIXED-TIER-CATALOG',
      owner: 'builder',
      lawPins: ['HL#6', 'HL#10'],
      nextRecommendedAction:
        'Post a chat run as `analyst` (low tier) targeting a frontier model; assert NVG denies with tier_ceiling_exceeded BEFORE any adapter call.',
    });
  });
});
