/**
 * tests/e2e/07-branching.e2e.test.ts — E2E v0.4.0 §3.7
 *
 * Category 7: multi-agent branching runs. Frontier → on-prem → multi
 * → compile is the deepest path the wall exercises.
 *
 * Owner directive 2026-05-21: no `it.skip`. Branching depends on
 * multi-agent DAG harness work (Category 4) + frontier-fixture
 * (Category 2). Catalog slots fail red until those land.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

function branchingBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'EXTERNAL_DEPENDENCY',
    reason: `Branching DAG requires frontier-fixture adapter + multi-agent harness helpers. Scenario: ${scenario}.`,
    blockedBy: 'FRONTIER-LIVE-OR-FIXTURE-V1',
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Resolve Category 2 + Category 4 blockers, then build a 4-node DAG harness helper.',
  });
}

describe('E2E Category 7 — multi-agent BRANCHING (frontier → on-prem → multi → compile)', () => {
  it('E2E-61-frontier-then-fan-out: sr_manager → frontier-survey → 3-agent fan-out', () => {
    branchingBlocked('E2E-61', 'sr_manager frontier survey → 3-agent fan-out', [
      'HL#6',
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-62-research-then-merge: director → frontier-news → extract+classify → merge', () => {
    branchingBlocked('E2E-62', 'director research → extract+classify → merge', [
      'HL#6',
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-63-trend-detect-then-action: vp → frontier-trend → validate → action-plan', () => {
    branchingBlocked('E2E-63', 'vp trend-detect → validate → action-plan', ['HL#6', 'HL#11']);
  });
  it('E2E-64-multi-loop-deep: executive → 4-deep on-prem chain', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-64',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "4-deep on-prem chain needs 4 distinct seeded agents per node — only `nexus-sales-agent` + `nexus-warehouse-agent` (NXS read) + default chat agent are seeded. A 4-deep chain on the SAME agent (reusing one of the seeded ones for each node) doesn't match the catalog's `multi-loop-deep` semantic (the loop's depth comes from distinct agent personalities). F-17 cascade: needs the named chat fan-out agents seeded first.",
      blockedBy: 'MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS',
      owner: 'owner',
      lawPins: ['HL#4', 'HL#8', 'HL#11'],
      nextRecommendedAction:
        "Owner ratification: seed 4 distinct chat-style agents with allowedSystems intersecting executive's seed. THEN build a 4-node sequential subTasks DAG with one node per agent. F-17 dependency means the F-17 seeding ratification unblocks this slot.",
    });
  });
  it('E2E-65-branching-with-output: ceo → 4-agent + executive_briefing_v1', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-65',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason: 'Requires output-contract template executive_briefing_v1 + multi-agent DAG harness.',
      blockedBy: 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1',
      owner: 'arch',
      lawPins: ['HL#8', 'HL#11'],
    });
  });
  it('E2E-66-3-stage-with-callback: vp → ambiguous next-agent → callback (HL #4)', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-66',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'No production-side `ambiguous next-agent` checkback trigger exists. Current `plan_checkback_required` emission paths in scripts/nexus-main.ts:2037/2102/2152 cover ONLY model-tier scenarios (preferred outside ceiling, preferred unhealthy, no healthy endpoints in policy-selected tiers). The catalog row asks for a planner-level branching ambiguity (no eligible next agent) that has no emitter today. Cannot body without that production surface.',
      blockedBy: 'E2E-CALLBACK-FLOW',
      owner: 'arch',
      lawPins: ['HL#4'],
      suspectedRootCause:
        'Planner-side checkback emitters are tier/health-driven only. HL#4 ambiguous-agent surface needs a new emit path in planner+coordinator (subsequent to plan_amendment that detects empty next-agent candidate set).',
      nextRecommendedAction:
        "Owner ratification + arch patch: add a `plan_checkback_required` emit with reason='ambiguous_next_agent' when the planner's branching evaluator returns an empty candidate set during multi-stage execution. THEN body this test using the new path (force ambiguity via two-stage plan with second stage's eligible-agent filter narrowing to empty, then resolve via harness.resolveCheckback).",
    });
  });
  it('E2E-67-branching-with-secure-rail: ceo → OCT-SECURE branch merges back', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-67',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "OCT-SECURE branch needs an OCT-SECURE-classified resource on a seeded connector. None exists today (sales/warehouse seeds top out at OCT-CONFIDENTIAL). ceo's allowedCapabilities includes the secret-read caps but there is no secret-tier resource to read. The catalog's `branch merges back` shape also requires multi-agent DAG harness helpers shared with E2E-64/E2E-68.",
      blockedBy: 'E2E-OCT-SURFACE',
      owner: 'owner',
      lawPins: ['HL#10', 'HL#11'],
      nextRecommendedAction:
        'Owner ratification: seed an OCT-SECURE-classified resource (paired with E2E-101 OCT-SECRET seed) + build the multi-agent merge-back DAG harness. THEN body the branch+merge shape.',
    });
  });
  it('E2E-68-conditional-branch: director → judge picks downstream agent', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-68',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Judge-driven conditional dispatch needs a seeded `judge-bot` chat agent (F-17 cascade) plus a planner-side conditional-edge primitive that lets the judge nominate the downstream node. Neither exists in the seed/runtime today.',
      blockedBy: 'MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS',
      owner: 'owner',
      lawPins: ['HL#4', 'HL#8'],
      nextRecommendedAction:
        'Owner ratification: seed the judge-bot agent (F-17) + arch patch to expose a conditional-edge primitive in subTaskEdges. THEN body this slot.',
    });
  });
  it('E2E-69-second-run-trigger: vp → checkbackSourceRunId chain (HL #12)', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-69',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Second-run chain requires creating run B with `checkbackSourceRunId: runA` so HL#12 verifies the chain provenance. The harness's createRun() body does not currently expose `checkbackSourceRunId` (see RunPostBody in tests/e2e/harness.ts:24-33), and the workspace HTTP POST /workspace/runs route surface needs verification that it accepts the field through the planner pipeline. Production surface gap, not body gap.",
      blockedBy: 'E2E-SECOND-RUN-CHAIN',
      owner: 'arch',
      lawPins: ['HL#12'],
      nextRecommendedAction:
        'Either (a) extend RunPostBody + the workspace HTTP route to thread `checkbackSourceRunId` to the planner, OR (b) confirm the field already flows through and only the harness type needs the extra optional property. After the field is reachable end-to-end, body this slot as runA → checkback → runB resolves checkback → assert HL#12 chain-provenance event fires.',
    });
  });
  it('E2E-70-branching-with-output-contract-and-mixed-tier: ceo → board_doc_v1', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-70',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Deepest happy path — requires output-contract templates, frontier-fixture, and multi-agent harness.',
      blockedBy: 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1',
      owner: 'arch',
      lawPins: ['HL#6', 'HL#8', 'HL#11'],
    });
  });
});
