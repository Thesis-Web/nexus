/**
 * tests/e2e/09-multi-source-merge.e2e.test.ts — E2E v0.4.0 §3.9
 *
 * Category 9: multi-source merge — sales + warehouse → cross-system
 * report. Exercises mailbox-per-actor (HL #8) + per-connector data
 * classification (F4.11).
 *
 * Owner directive 2026-05-21: no `it.skip`. Every multi-source scenario
 * needs two NXS pulls before merge — blocked on the NXS dispatch
 * bridge bug (see E2E-23).
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BRIDGE_BLOCKER = 'NXS-DISPATCH-BRIDGE-RETURNS-NULL';

function mergeBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'PRODUCT_RUNTIME',
    reason: `Multi-source merge ${scenario} requires two successful NXS pulls; bridge currently returns null (see E2E-23).`,
    blockedBy: BRIDGE_BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Fix bridge. Then build merge harness helper: post a DAG with two NXS pull nodes feeding a compile node; assert per-actor mailbox isolation and merge correctness.',
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
