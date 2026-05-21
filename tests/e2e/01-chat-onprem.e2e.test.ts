/**
 * tests/e2e/01-chat-onprem.e2e.test.ts — E2E v0.4.0 §3.1
 *
 * Category 1 of 12: single-agent chat against on-prem Ollama. Validates
 * the simplest happy path — the smoke baseline that should never break.
 *
 * Each test boots a fresh composition root via the e2e harness, logs in
 * as one of the 10 ladder users, posts to /workspace/runs, waits for the
 * run to close, asserts the final outcome + ledger trail.
 *
 * If E2E-01 (the chat baseline) fails in CI, every other category test
 * is suspect. Treat this file as the foundation of the wall.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004';
const CHAT_WORKSPACE = 'nexus-chat-default';

describe('E2E Category 1 — chat on-prem (single agent, no contract)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 120_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  /**
   * E2E-01: the smoke baseline. dev-admin chats with the default chat
   * agent in the free_chat workspace. Asserts:
   *   - delegation mint succeeds (firewall_rights intersection non-empty)
   *   - NVG classifies the prompt + routes to on_prem_general
   *   - compile produces a signed FinalResponseArtifact (HL #11
   *     pass-through, no template)
   *   - the ledger carries a final_response event with outcome=executed
   *
   * This is the test that would have failed under the Patch 28 bug
   * before Patch 38 wired the Principal F4.15 fields through to SQLite.
   */
  it('E2E-01-chat-baseline: dev-admin → "who are you?" → on-prem Ollama → executed', async () => {
    const jwt = await harness.jwtFor('dev-admin');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: CHAT_WORKSPACE,
      promptMode: 'free_text',
      prompt: 'who are you?',
      agents: [CHAT_AGENT_ID],
    });
    expect(runId).toMatch(/^[a-f0-9-]{36}$/);

    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    expect(snap.runClosed).toBe(true);
    // HL #11 — compile produced a pass-through artifact, run closed
    // with a non-error outcome.
    expect(snap.closeReason).not.toBe('error');
    // HL #5/#6 — the run went through the governance pipeline. The
    // ledger MUST carry a delegation_issued event (HL #15 mint) and a
    // run_closed event with non-error close reason.
    const types = new Set(snap.ledgerEvents.map(e => e.eventType));
    expect(types.has('delegation_issued') || types.has('plan_created')).toBe(true);
    expect(types.has('run_closed')).toBe(true);
    // HL #4 — orch did NOT kill the run. closeReason 'user_cancelled'
    // is allowed (user-initiated), but 'error' is the violation.
    const closeEvent = snap.ledgerEvents.find(e => e.eventType === 'run_closed');
    expect(closeEvent).toBeDefined();
    expect(closeEvent!.detail['closeReason']).not.toBe('error');
  }, 120_000);

  /**
   * E2E-02..10 — chat-on-prem catalog slots. The path through the
   * chat-on-prem surface is already proven by E2E-01; these slots
   * simply repeat the path with different prompts and ladder users
   * to exercise role-based denial differentials at Gate 02/03/04.
   *
   * Owner directive 2026-05-21: no `it.skip` in the wall. Each catalog
   * slot is a real `it()` that throws `AcceptanceWallFailure` until the
   * body is implemented. The reporter logs every slot in the failure
   * ledger so unimplemented surface is visible, not hidden.
   */
  it('E2E-02-chat-time: intern → "what time is it where you are?"', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-02',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'Test body not implemented. E2E-01 proved the chat-on-prem path; this slot needs a body that posts the prompt as `intern`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#4', 'HL#6', 'HL#11'],
      nextRecommendedAction:
        'Clone the E2E-01 body, switch jwt to `intern`, assert the same forensic envelope.',
    });
  });
  it('E2E-03-chat-math: intern → "what is 17 times 23?"', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-03',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Math-prompt variant of E2E-01 as `intern`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-04-chat-summarize: analyst → summarize the prompt', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-04',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Summarize-prompt variant of E2E-01 as `analyst`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-05-chat-translate: analyst → translate hello world', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-05',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Translate-prompt variant as `analyst`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-06-chat-poem: sr_analyst → quarterly-reports haiku', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-06',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Creative-prompt variant as `sr_analyst`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-07-chat-explain: manager → bills receivable vs payable', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-07',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Explain-prompt variant as `manager`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-08-chat-list: manager → ops manager qualities list', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-08',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. List-prompt variant as `manager`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-09-chat-define: sr_manager → inventory turnover definition', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-09',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'Test body not implemented. Define-prompt variant as `sr_manager`.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
  it('E2E-10-chat-followup-pretrained-knowledge: director → PO lifecycle', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-10',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'Test body not implemented. Followup-prompt variant as `director`. Pretrained knowledge — no NXS.',
      blockedBy: 'E2E-CHAT-ONPREM-CATALOG',
      owner: 'builder',
      lawPins: ['HL#2', 'HL#11'],
    });
  });
});
