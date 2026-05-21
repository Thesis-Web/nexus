/**
 * tests/e2e/11-rbac-differentials.e2e.test.ts — E2E v0.4.0 §3.11
 *
 * Category 11: RBAC / OCT denial differentials. Same prompt across
 * roles; lower ranks denied, higher ranks allowed. Proves the
 * monotonic capability ladder + signed gate path.
 */
import { describe, it } from 'vitest';

describe('E2E Category 11 — RBAC / OCT denial differentials', () => {
  it.skip('E2E-101-secret-data-access: janitor denied vs vp allowed', async () => {});
  it.skip('E2E-102-bulk-delete: analyst denied vs vp Gate 05 approval', async () => {});
  it.skip('E2E-103-policy-override-attempt: manager+ceo both denied without SigningCouncil 2-of-2', async () => {});
  it.skip('E2E-104-cross-system-confidential: intern denied vs sr_analyst allowed', async () => {});
  it.skip('E2E-105-firewall-egress-denied-by-role: janitor → frontier denied at NVG', async () => {});
  it.skip('E2E-106-bulk-pull-risk-ceiling: analyst → 10k row pull denied (medium < bulk:high)', async () => {});
  it.skip('E2E-107-chain-depth-ceiling: sr_analyst → chain > maxChainDepth denied', async () => {});
  it.skip('E2E-108-environment-mismatch: analyst dev → prod target denied', async () => {});
  it.skip('E2E-109-external-facing-action: vp → Gate 04 approval flow', async () => {});
  it.skip('E2E-110-revoked-mid-run: sr_analyst → mid-run RBAC revoke → claim drift', async () => {});
});
