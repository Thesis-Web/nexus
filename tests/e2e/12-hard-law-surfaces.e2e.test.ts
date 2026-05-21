/**
 * tests/e2e/12-hard-law-surfaces.e2e.test.ts — E2E v0.4.0 §3.12
 *
 * Category 12: each test targets one Hard Law's enforcement surface
 * directly. This is the structural-invariant suite — if anything
 * here fails, every other test is suspect.
 */
import { describe, it } from 'vitest';

describe('E2E Category 12 — Hard Law surfaces', () => {
  it.skip('E2E-111-hl1-auth-first: no auth → 401 before any gate', async () => {});
  it.skip('E2E-112-hl4-orch-no-kill: planner unable to resolve → callback (not deny)', async () => {});
  it.skip('E2E-113-hl5-nxs-only-action-auth: agent NXS-bypass via side-channel → blocked', async () => {});
  it.skip('E2E-114-hl6-nvg-sole-llm-auth: agent direct LLM call → blocked', async () => {});
  it.skip('E2E-115-hl7-llm-no-tool-descriptors: nvg_outbound payload has empty toolDescriptors', async () => {});
  it.skip('E2E-116-hl8-mailbox-only-data-hub: cross-actor mailbox read denied', async () => {});
  it.skip('E2E-117-hl11-compile-passthrough: single agent + no contract = verbatim forward', async () => {});
  it.skip('E2E-118-hl14-claim-drift: mid-run RBAC change halts with claim_drift_detected', async () => {});
  it.skip('E2E-119-hl15-symmetric-intersection: real per-dimension differential', async () => {});
  it.skip('E2E-120-hl16-agent-touches-only-mailboxes: agent → NXS/NVG/ledger direct call blocked', async () => {});
});
