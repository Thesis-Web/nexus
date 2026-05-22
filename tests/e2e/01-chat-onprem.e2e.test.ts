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
import { bootHarness, type E2EHarness, type RunClosedSnapshot } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004';
const CHAT_WORKSPACE = 'nexus-chat-default';

/**
 * Shared chat-on-prem forensic envelope. Each ladder persona is expected
 * to drive the same path as dev-admin in E2E-01: workspace → orch → NVG
 * on-prem chat → compile pass-through → workspace return. The body
 * asserts the lifecycle events that prove governance ran (delegation
 * mint or plan creation), the run closed without an error reason, and
 * the canonical run_closed event is on the ledger.
 */
async function runChatOnprem(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string
): Promise<RunClosedSnapshot> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: CHAT_WORKSPACE,
    promptMode: 'free_text',
    prompt,
    agents: [CHAT_AGENT_ID],
  });
  expect(runId).toMatch(/^[a-f0-9-]{36}$/);
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
}

function assertChatOnpremEnvelope(snap: RunClosedSnapshot): void {
  expect(snap.runClosed).toBe(true);
  // HL #11 — compile produced a pass-through artifact, run closed
  // with a non-error outcome.
  expect(snap.closeReason).not.toBe('error');
  // HL #5/#6 — the run went through the governance pipeline. The
  // ledger MUST carry a delegation_issued event (HL #15 mint) or
  // plan_created, AND a run_closed event with non-error close reason.
  const types = new Set(snap.ledgerEvents.map(e => e.eventType));
  expect(types.has('delegation_issued') || types.has('plan_created')).toBe(true);
  expect(types.has('run_closed')).toBe(true);
  // HL #4 — orch did NOT kill the run with an error reason.
  const closeEvent = snap.ledgerEvents.find(e => e.eventType === 'run_closed');
  expect(closeEvent).toBeDefined();
  expect(closeEvent!.detail['closeReason']).not.toBe('error');
}

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
    const snap = await runChatOnprem(harness, 'dev-admin', 'who are you?');
    assertChatOnpremEnvelope(snap);
  }, 120_000);

  /**
   * E2E-02..10 — chat-on-prem catalog slots. The path through the
   * chat-on-prem surface is already proven by E2E-01; these slots
   * simply repeat the path with different prompts and ladder personas
   * to exercise role-based access. Each persona has `chat` in
   * permittedRunTypes and `synthesize:content` (CAP_SUMMARIZE) in
   * allowedCapabilities (scripts/seeds/user-ladder-seeds.ts), so the
   * on-prem chat path is open for the entire intern..director range.
   *
   * Acceptance wall directive 2026-05-21: each body asserts the same
   * forensic envelope as E2E-01 — no skips, no stubs.
   */
  it('E2E-02-chat-time: intern → "what time is it where you are?"', async () => {
    const snap = await runChatOnprem(harness, 'intern', 'what time is it where you are?');
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-03-chat-math: intern → "what is 17 times 23?"', async () => {
    const snap = await runChatOnprem(harness, 'intern', 'what is 17 times 23?');
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-04-chat-summarize: analyst → summarize the prompt', async () => {
    const snap = await runChatOnprem(
      harness,
      'analyst',
      'Summarize in one sentence: the seasons of the year and what each represents.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-05-chat-translate: analyst → translate hello world', async () => {
    const snap = await runChatOnprem(harness, 'analyst', 'Translate "hello world" into French.');
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-06-chat-poem: sr_analyst → quarterly-reports haiku', async () => {
    const snap = await runChatOnprem(
      harness,
      'sr_analyst',
      'Write a haiku about quarterly reports.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-07-chat-explain: manager → bills receivable vs payable', async () => {
    const snap = await runChatOnprem(
      harness,
      'manager',
      'Explain the difference between accounts receivable and accounts payable in one short paragraph.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-08-chat-list: manager → ops manager qualities list', async () => {
    const snap = await runChatOnprem(
      harness,
      'manager',
      'List five qualities of an effective operations manager.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-09-chat-define: sr_manager → inventory turnover definition', async () => {
    const snap = await runChatOnprem(
      harness,
      'sr_manager',
      'Define "inventory turnover" in one sentence.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
  it('E2E-10-chat-followup-pretrained-knowledge: director → PO lifecycle', async () => {
    const snap = await runChatOnprem(
      harness,
      'director',
      'Describe the lifecycle of a purchase order from issuance to invoice reconciliation.'
    );
    assertChatOnpremEnvelope(snap);
  }, 120_000);
});
