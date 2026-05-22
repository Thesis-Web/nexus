/**
 * tests/e2e/09-multi-source-merge.e2e.test.ts — E2E v0.4.0 §3.9
 *
 * Category 9: multi-source merge — sales + warehouse → cross-system
 * report. Exercises mailbox-per-actor (HL #8) + per-connector data
 * classification (F4.11).
 *
 * Owner directive 2026-05-21: no `it.skip`. Bridge fix landed
 * 2026-05-22 (43e5ed3) so both upstream NXS pulls now run. The
 * remaining blocker on every merge scenario is the F4.12 multi-item
 * compile pass-through (HANDOFF §F priority #6, structurally blocked
 * on §C.3 test-migration ratification by audit/arch) — compile today
 * proves single-item pass-through (E2E-117) but the multi-source
 * merge requires assembling two mailbox items into one artifact.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const F412_BLOCKER = 'F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH';

function mergeBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'UNIMPLEMENTED_SURFACE',
    reason: `Multi-source merge ${scenario} now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.`,
    blockedBy: F412_BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).',
  });
}

describe('E2E Category 9 — multi-source merge + cross-system report', () => {
  it('E2E-81-quarterly-coverage: sr_manager → can we cover Q2 orders?', () => {
    mergeBlocked('E2E-81', 'sales orders + warehouse inventory', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-82-stockout-risk: manager → SKUs at risk this month', () => {
    mergeBlocked('E2E-82', 'sales velocity + warehouse stock', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-83-reorder-recommendations: sr_manager → reorder plan', () => {
    mergeBlocked('E2E-83', 'sales + warehouse + reorder thresholds', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-84-customer-shipping-perf: manager → on-time shipping report', () => {
    mergeBlocked('E2E-84', 'sales orders + warehouse shipments', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-85-sku-margin-analysis: director → margin-by-SKU', () => {
    mergeBlocked('E2E-85', 'sales prices + warehouse cost', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-86-quarterly-forecast: vp → sales+warehouse+frontier-trends', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-86',
      failureClass: 'EXTERNAL_DEPENDENCY',
      reason: 'Needs frontier-fixture (Category 2 blocker) AND bridge fix.',
      blockedBy: 'FRONTIER-LIVE-OR-FIXTURE-V1',
      owner: 'arch',
      lawPins: ['HL#5', 'HL#6', 'HL#8', 'HL#11'],
    });
  });
  it('E2E-87-anomaly-detect: sr_manager → refunds vs returns anomalies', () => {
    mergeBlocked('E2E-87', 'refund returns anomaly join', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-88-supply-chain-snapshot: director → board snapshot', () => {
    mergeBlocked('E2E-88', 'cross-system board snapshot', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-89-margin-by-region: vp → margin per region', () => {
    mergeBlocked('E2E-89', 'sales + region tagging + cost', ['HL#5', 'HL#8', 'HL#11']);
  });
  it('E2E-90-cross-system-audit: ceo → reconciliation report via secure_rails', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-90',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason: 'secure_rails promptMode + reconciliation contract — neither built.',
      blockedBy: 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1',
      owner: 'arch',
      lawPins: ['HL#10', 'HL#11'],
    });
  });
});
