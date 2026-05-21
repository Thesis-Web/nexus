/**
 * tests/e2e/04-multi-no-contract.e2e.test.ts — E2E v0.4.0 §3.4
 *
 * Category 4: multi-agent runs without an output contract. Each agent
 * does its thing, results bundle into a multi-item FinalResponseArtifact
 * (HL #11 + F4.12 multi-item pass-through).
 *
 * Owner directive 2026-05-21: no `it.skip`. Catalog slots fail red with
 * structured detail; the multi-agent dispatch path itself is unproven
 * end-to-end (no real multi-node E2E has landed yet).
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BLOCKER = 'E2E-MULTI-NO-CONTRACT-CATALOG';

function multiNoContractBlocked(
  testId: string,
  scenario: string,
  lawPins: ReadonlyArray<string>
): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'UNIMPLEMENTED_TEST_BODY',
    reason: `Multi-agent no-contract DAG dispatch is unproven via HTTP E2E; needs harness work + sample agents. Scenario: ${scenario}.`,
    blockedBy: BLOCKER,
    owner: 'builder',
    lawPins,
    nextRecommendedAction:
      'Build harness helper that posts a 2-node subTasks DAG with two chat agents, then assert: per-agent mailbox isolation, per-agent NVG event, compile multi-item bundle, no contract template invocation.',
  });
}

describe('E2E Category 4 — multi-agent, no output contract', () => {
  it('E2E-31-multi-chat-fan-out: sr_analyst → analyst-bot + summary-bot', () => {
    multiNoContractBlocked('E2E-31', 'sr_analyst fans out chat to two on-prem chat agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-32-multi-domain-experts: manager → finance-bot + ops-bot', () => {
    multiNoContractBlocked('E2E-32', 'manager fan-out to two domain-expert agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-33-multi-language-pair: sr_manager → english-bot + french-bot', () => {
    multiNoContractBlocked('E2E-33', 'sr_manager fan-out to two language-pair agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-34-multi-tone: director → formal-bot + casual-bot', () => {
    multiNoContractBlocked('E2E-34', 'director fan-out — tone differential', ['HL#8', 'HL#11']);
  });
  it('E2E-35-multi-judge-format: director → response-bot + judge-bot', () => {
    multiNoContractBlocked('E2E-35', 'director response + judge', ['HL#8', 'HL#11']);
  });
  it('E2E-36-multi-fact-fact-judge: vp → fact1-bot + fact2-bot + judge-bot', () => {
    multiNoContractBlocked('E2E-36', 'vp three-agent fact + fact + judge', ['HL#8', 'HL#11']);
  });
  it('E2E-37-multi-2x-parallel-pull: manager → sales-pull + warehouse-pull', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-37',
      failureClass: 'PRODUCT_RUNTIME',
      reason:
        'NXS dispatch bridge returns null on the connector path (see E2E-23 failure). Two parallel NXS pulls cannot complete until the bridge is fixed.',
      blockedBy: 'NXS-DISPATCH-BRIDGE-RETURNS-NULL',
      owner: 'arch',
      lawPins: ['HL#5', 'HL#8', 'HL#11'],
      suspectedRootCause:
        'scripts/nexus-main.ts NXS dispatch bridge — finalOutcome=error_dispatch, evidence had no executionResult',
      nextRecommendedAction: 'Fix the bridge (see E2E-23 ledger detail) before this test can pass.',
    });
  });
  it('E2E-38-multi-translate-pair: sr_manager → en-fr + en-es', () => {
    multiNoContractBlocked('E2E-38', 'sr_manager translate pair', ['HL#8', 'HL#11']);
  });
  it('E2E-39-multi-perspective-shootout: vp → exec/analyst/intern perspectives', () => {
    multiNoContractBlocked('E2E-39', 'vp three-agent perspective shootout', ['HL#8', 'HL#11']);
  });
  it('E2E-40-multi-no-contract-bundle-shape: executive → bundle FinalResponseArtifact carries both items', () => {
    multiNoContractBlocked(
      'E2E-40',
      'executive bundle-shape assertion — two mailbox items → one multi-item artifact',
      ['HL#11', 'F4.12']
    );
  });
});
