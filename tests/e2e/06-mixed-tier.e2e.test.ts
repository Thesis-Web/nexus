/**
 * tests/e2e/06-mixed-tier.e2e.test.ts — E2E v0.4.0 §3.6
 *
 * Category 6: multi-agent mixed on-prem + frontier. NVG routes per
 * node, mailbox carries between turns.
 */
import { describe, it } from 'vitest';

describe('E2E Category 6 — multi-agent MIXED on-prem + frontier', () => {
  it.skip('E2E-51-onprem-then-frontier: sr_analyst → summarize → elaborate', async () => {});
  it.skip('E2E-52-frontier-then-onprem: sr_manager → research → summarize', async () => {});
  it.skip('E2E-53-mixed-parallel: manager → onprem-A + frontier-B → judge', async () => {});
  it.skip('E2E-54-3-stage-mixed: director → onprem → frontier → onprem-format', async () => {});
  it.skip('E2E-55-mixed-with-nxs: sr_manager → nxs-pull → onprem-summarize → frontier-polish', async () => {});
  it.skip('E2E-56-mixed-with-output-contract: vp → board doc with frontier research', async () => {});
  it.skip('E2E-57-mixed-translation-pair: vp → onprem-en-fr + frontier-en-zh', async () => {});
  it.skip('E2E-58-mixed-cost-routing-check: executive → low-cost on-prem + high-cost frontier', async () => {});
  it.skip('E2E-59-mixed-fallback: director → frontier unhealthy → on-prem fallback', async () => {});
  it.skip('E2E-60-mixed-denied-by-tier-ceiling: analyst → frontier denied at NVG', async () => {});
});
