/**
 * tests/e2e/02-chat-frontier.e2e.test.ts — E2E v0.4.0 §3.2
 *
 * Category 2 of 12: single-agent chat through the frontier tier. Real
 * frontier (Anthropic / OpenAI / current-data) is intentionally NOT a
 * deterministic CI dependency — these tests are blocked until the
 * frontier-fixture adapter lands so CI is reproducible. Until then
 * every slot fails with EXTERNAL_DEPENDENCY blockedBy=FRONTIER-LIVE-
 * OR-FIXTURE-V1 so the wall surfaces the gap.
 *
 * Owner directive 2026-05-21: no `it.skip`. Every catalog slot is a
 * real `it()` that throws `AcceptanceWallFailure`.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BLOCKER = 'FRONTIER-LIVE-OR-FIXTURE-V1';

function frontierBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'EXTERNAL_DEPENDENCY',
    reason: `Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: ${scenario}.`,
    blockedBy: BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.',
  });
}

describe('E2E Category 2 — chat frontier (single agent, requires online search)', () => {
  it('E2E-11-frontier-search-news: analyst → Bitcoin price', () => {
    frontierBlocked('E2E-11', 'analyst frontier search — current Bitcoin price', ['HL#6', 'HL#11']);
  });
  it('E2E-12-frontier-yahoo-biggest-movers: analyst → S&P movers', () => {
    frontierBlocked('E2E-12', 'analyst frontier finance — S&P biggest movers', ['HL#6', 'HL#11']);
  });
  it('E2E-13-frontier-current-events: manager → tech news this week', () => {
    frontierBlocked('E2E-13', 'manager frontier news — tech this week', ['HL#6', 'HL#11']);
  });
  it('E2E-14-frontier-weather: sr_manager → SF weather right now', () => {
    frontierBlocked('E2E-14', 'sr_manager frontier weather', ['HL#6', 'HL#11']);
  });
  it('E2E-15-frontier-stock-quote: director → AAPL day change', () => {
    frontierBlocked('E2E-15', 'director frontier stock quote', ['HL#6', 'HL#11']);
  });
  it('E2E-16-frontier-research: vp → IMF outlook top three findings', () => {
    frontierBlocked('E2E-16', 'vp frontier research — IMF outlook', ['HL#6', 'HL#11']);
  });
  it('E2E-17-frontier-citation: vp → peer-reviewed inventory papers', () => {
    frontierBlocked('E2E-17', 'vp frontier citation — academic search', ['HL#6', 'HL#11']);
  });
  it('E2E-18-frontier-compare-models: executive → GPT-4 vs Claude business analytics', () => {
    frontierBlocked('E2E-18', 'executive frontier compare-models', ['HL#6', 'HL#11']);
  });
  it('E2E-19-frontier-fact-check: executive → Tesla Q3 2024 deliveries', () => {
    frontierBlocked('E2E-19', 'executive frontier fact-check', ['HL#6', 'HL#11']);
  });
  it('E2E-20-frontier-deep-dive: ceo → semiconductor supply chain briefing', () => {
    frontierBlocked('E2E-20', 'ceo frontier deep-dive', ['HL#6', 'HL#11']);
  });
});
