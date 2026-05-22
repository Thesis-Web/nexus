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
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Verified at HEAD 343ed2f: the nxs-pull leg works (E2E-37 proves manager 2x NXS; sr_manager has the same systems). The on-prem summarize and frontier-polish legs need an agent declaring synthesize:content (CAP_SUMMARIZE) — only the default chat agent carries it (scripts/nexus-bootstrap.ts:1361-1362, allowedSystems=['stub']). Whether F-15's chat-agent intersection-empty applies to a kind=nvg subTask in a governed_only workspace (vs a free_chat workspace) is unverified — needs runtime confirmation. Also unverified: whether the orch planner supports subTasks beyond `kind: nxs` in a multi-stage chain (every green E2E uses kind=nxs only). OpenAI endpoint IS wired and resolvable via vault, so the frontier-polish leg itself is not blocked on credentials.",
      blockedBy: 'CHAT-AGENT-LADDER-INTERSECTION-EMPTY',
      owner: 'arch',
      lawPins: ['HL#5', 'HL#6', 'HL#11'],
      nextRecommendedAction:
        'Confirm (a) whether F-15 applies to kind=nvg / kind=chat subTasks in governed_only workspaces, and (b) whether the orch pipeline supports a 3-stage NXS→summarize→polish subTask chain end-to-end. Both are read-the-runtime questions, not owner-ratification. After verification, body or surface-block based on what the runtime actually does.',
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
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Catalog row persona is `analyst`. Reaching NVG tier-ceiling requires the chat path (free_text → NVG classify/route → adapter denied on user.maxRiskTier < frontier). But the default chat agent's allowedSystems=['stub'] is disjoint from analyst's allowedSystems=['sales-finance'] — F-15 fires `delegation_empty_intersection` on target_systems BEFORE NVG runs, so the tier-ceiling assertion can never fire on the analyst persona. Either F-15 must resolve first (then this body becomes a clone of the E2E-02..10 chat pattern with a frontier-tier prompt + tier_ceiling_exceeded assertion), OR a separate non-chat NVG entry path must exist for tier denial.",
      blockedBy: 'CHAT-AGENT-LADDER-INTERSECTION-EMPTY',
      owner: 'owner',
      lawPins: ['HL#6', 'HL#10'],
      suspectedRootCause:
        'F-15 cascade (REPAIR-MODE-FINDINGS-2026-05-22-body-build.md): non-`dev-admin` ladder personas cannot mint a chat delegation against the default chat agent. Pre-NVG denial pre-empts the tier-ceiling test surface.',
      nextRecommendedAction:
        'Land any F-15 resolution option (chat agent allowedSystems=[] + intersection law treats empty-on-agent-side as no-system-gate, OR planner skips target_systems intersection when entryMode=free_chat). After that lands, body this slot as `analyst` chat run with a frontier-tier prompt + assert `tier_ceiling_exceeded` (or the equivalent NVG denial event) fires BEFORE any frontier adapter call.',
    });
  });
});
