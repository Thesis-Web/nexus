/**
 * tests/e2e/02-chat-frontier.e2e.test.ts — E2E v0.4.0 §3.2
 *
 * Category 2 of 12: single-agent chat through the frontier tier
 * (requires a healthy frontier adapter — Anthropic / OpenAI). Tests
 * skip cleanly when frontier is unconfigured; rest of the wall keeps
 * compiling against them so the structural surface stays visible.
 */
import { describe, it } from 'vitest';

describe('E2E Category 2 — chat frontier (single agent, requires online search)', () => {
  it.skip('E2E-11-frontier-search-news: analyst → Bitcoin price', async () => {
    // Build queue: spec §3.2 row 1.
  });
  it.skip('E2E-12-frontier-yahoo-biggest-movers: analyst → S&P movers', async () => {});
  it.skip('E2E-13-frontier-current-events: manager → tech news this week', async () => {});
  it.skip('E2E-14-frontier-weather: sr_manager → SF weather right now', async () => {});
  it.skip('E2E-15-frontier-stock-quote: director → AAPL day change', async () => {});
  it.skip('E2E-16-frontier-research: vp → IMF outlook top three findings', async () => {});
  it.skip('E2E-17-frontier-citation: vp → peer-reviewed inventory papers', async () => {});
  it.skip('E2E-18-frontier-compare-models: executive → GPT-4 vs Claude business analytics', async () => {});
  it.skip('E2E-19-frontier-fact-check: executive → Tesla Q3 2024 deliveries', async () => {});
  it.skip('E2E-20-frontier-deep-dive: ceo → semiconductor supply chain briefing', async () => {});
});
