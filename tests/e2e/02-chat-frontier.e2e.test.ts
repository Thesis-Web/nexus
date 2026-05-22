/**
 * tests/e2e/02-chat-frontier.e2e.test.ts — E2E v0.4.0 §3.2
 *
 * Category 2 of 12: single-agent chat through the frontier tier. Each
 * test pins `preferredEndpointId: 'openai-gpt'` so the run targets the
 * enabled frontier endpoint (config/nvg/endpoints.v1.yaml line 28-38,
 * tier=frontier_general, auth=bearer via vault file:OPENAI_API_KEY).
 *
 * Test-Body Factory mode 2026-05-22: bodies attempt the real frontier
 * path. If the run executes, the governed envelope (run_closed,
 * final_response) must fire and no node_failed event. If the persona's
 * maxRiskTier or firewall rights deny frontier, the run closes with a
 * denial trail and the test still asserts the canonical denial shape.
 * Either outcome is real — the assertion accepts both clean execution
 * and the deterministic denial trail, and rejects only fabricated /
 * dropped paths (bridge null, error_dispatch).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness, type RunClosedSnapshot } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004';
const CHAT_WORKSPACE = 'nexus-chat-default';
const FRONTIER_ENDPOINT = 'openai-gpt';

async function runFrontierChat(
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
    preferredEndpointId: FRONTIER_ENDPOINT,
  });
  expect(runId).toMatch(/^[a-f0-9-]{36}$/);
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
}

function assertFrontierEnvelope(snap: RunClosedSnapshot): void {
  // Production-shape: catalog asks for a successful frontier chat
  // execution. The persona's allowed tier must permit frontier; the
  // adapter must reach OpenAI; compile must emit a final_response.
  const types = snap.ledgerEvents.map(e => e.eventType);
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'frontier chat closes completed').toBe('completed');
  expect(types, 'run_closed event present').toContain('run_closed');
  expect(types, 'final_response event present').toContain('final_response');
  expect(types, 'no node_failed').not.toContain('node_failed');
  expect(types, 'no error_dispatch').not.toContain('error_dispatch');
  expect(
    snap.ledgerEvents.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
    'no bridge-null events'
  ).toBe(false);
  expect(
    snap.ledgerEvents.some(e => e.eventType === 'unsolicited_model_tool_call'),
    'HL#7 — model emitted no unsolicited tool call'
  ).toBe(false);
}

describe('E2E Category 2 — chat frontier (single agent, requires online search)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-11-frontier-search-news: analyst → Bitcoin price', async () => {
    const snap = await runFrontierChat(
      harness,
      'analyst',
      'What is the current price of Bitcoin in USD right now?'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-12-frontier-yahoo-biggest-movers: analyst → S&P movers', async () => {
    const snap = await runFrontierChat(
      harness,
      'analyst',
      "Today's biggest gainers and losers in the S&P 500 by percent change."
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-13-frontier-current-events: manager → tech news this week', async () => {
    const snap = await runFrontierChat(
      harness,
      'manager',
      'Summarize the top three technology-industry news stories from this past week.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-14-frontier-weather: sr_manager → SF weather right now', async () => {
    const snap = await runFrontierChat(
      harness,
      'sr_manager',
      'What is the current temperature and conditions in San Francisco, CA?'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-15-frontier-stock-quote: director → AAPL day change', async () => {
    const snap = await runFrontierChat(
      harness,
      'director',
      "AAPL's intraday percent change today; one number, no commentary."
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-16-frontier-research: vp → IMF outlook top three findings', async () => {
    const snap = await runFrontierChat(
      harness,
      'vp',
      'Identify three top findings in the most recent IMF World Economic Outlook report.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-17-frontier-citation: vp → peer-reviewed inventory papers', async () => {
    const snap = await runFrontierChat(
      harness,
      'vp',
      'List three peer-reviewed papers from 2023-2025 on inventory-management forecasting; include title, authors, and venue.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-18-frontier-compare-models: executive → GPT-4 vs Claude business analytics', async () => {
    const snap = await runFrontierChat(
      harness,
      'executive',
      'Compare GPT-4 and Claude across business-analytics use cases: strengths, weaknesses, and when each is preferable.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-19-frontier-fact-check: executive → Tesla Q3 2024 deliveries', async () => {
    const snap = await runFrontierChat(
      harness,
      'executive',
      'Fact-check: how many vehicles did Tesla deliver in Q3 2024? Cite the source.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);

  it('E2E-20-frontier-deep-dive: ceo → semiconductor supply chain briefing', async () => {
    const snap = await runFrontierChat(
      harness,
      'ceo',
      'Brief me on the current state of the global semiconductor supply chain in five sentences.'
    );
    assertFrontierEnvelope(snap);
  }, 240_000);
});
