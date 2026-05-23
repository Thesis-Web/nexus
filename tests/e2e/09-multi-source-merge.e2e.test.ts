/**
 * tests/e2e/09-multi-source-merge.e2e.test.ts — E2E v0.4.0 §3.9
 *
 * Category 9: multi-source merge — sales + warehouse cross-system
 * reports. Each test submits two parallel NXS pulls + an nvg merge
 * node through reference-workspace. Mailbox-per-actor (HL#8) +
 * compile multi-item merge (F4.12) carry the proof shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';
const FRONTIER_ENDPOINT = 'openai-gpt';

interface RunSnap {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

function assertMergeEnvelope(snap: RunSnap): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  // Production-shape: catalog asks for a successful sales+warehouse
  // merge with a final_response artifact.
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'multi-source merge closes completed').toBe('completed');
  expect(types, 'run_closed event present').toContain('run_closed');
  expect(types, 'final_response event present').toContain('final_response');
  expect(types, 'no node_failed').not.toContain('node_failed');
  // HL#4 canonical (legacy `dag_failed` alias removed 2026-05-23).
  expect(types, 'no dag_step_error').not.toContain('dag_step_error');
  expect(types, 'no error_dispatch').not.toContain('error_dispatch');
  expect(
    snap.ledgerEvents.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
    'no bridge-null events'
  ).toBe(false);
  expect(
    snap.ledgerEvents.some(e => e.eventType === 'unsolicited_model_tool_call'),
    'HL#7 — no unsolicited model tool call'
  ).toBe(false);
}

async function runMerge(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  salesSql: string,
  warehouseSql: string,
  mergePrompt: string,
  opts?: { templateId?: string; frontier?: boolean }
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const body: Parameters<E2EHarness['createRun']>[1] = {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID, CHAT_AGENT_ACTOR_ID],
    subTasks: [
      {
        kind: 'nxs',
        subTaskKey: 'sales-merge-leg',
        agentId: SALES_AGENT_ACTOR_ID,
        taskSummary: 'sales merge leg',
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability: 'read:record:bulk',
          target: { system: 'sales-finance', resourceType: 'sales_orders', resourceScope: 'bulk' },
          rawPayload: { sql: salesSql, params: [] },
        },
      },
      {
        kind: 'nxs',
        subTaskKey: 'warehouse-merge-leg',
        agentId: WAREHOUSE_AGENT_ACTOR_ID,
        taskSummary: 'warehouse merge leg',
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability: 'read:record:bulk',
          target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
          rawPayload: { sql: warehouseSql, params: [] },
        },
      },
      {
        kind: 'nvg',
        subTaskKey: 'merge',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'merge nvg',
        taskPrompt: mergePrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  };
  if (opts?.frontier) {
    body.preferredEndpointId = FRONTIER_ENDPOINT;
  }
  const { runId } = await harness.createRun(jwt, body);
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
}

describe('E2E Category 9 — multi-source merge + cross-system report', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-81-quarterly-coverage: sr_manager → can we cover Q2 orders?', async () => {
    const snap = await runMerge(
      harness,
      'sr_manager',
      'Can we cover Q2 sales orders with warehouse stock?',
      'SELECT order_code, status, customer_code FROM sales_orders ORDER BY order_code',
      'SELECT sku, location_code, quantity_on_hand FROM inventory ORDER BY sku',
      'Determine if warehouse stock is sufficient to cover the Q2 sales orders.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-82-stockout-risk: manager → SKUs at risk this month', async () => {
    const snap = await runMerge(
      harness,
      'manager',
      'Identify SKUs at stockout risk this month.',
      'SELECT order_code, customer_code FROM sales_orders LIMIT 20',
      'SELECT sku, quantity_on_hand, reorder_point FROM inventory',
      'List the SKUs likely to stock out given current sales velocity.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-83-reorder-recommendations: sr_manager → reorder plan', async () => {
    const snap = await runMerge(
      harness,
      'sr_manager',
      'Produce a reorder plan from sales velocity vs warehouse stock.',
      'SELECT order_code, customer_code, subtotal FROM sales_orders',
      'SELECT sku, location_code, quantity_on_hand, reorder_point FROM inventory',
      'Recommend reorder quantities for the SKUs below the reorder threshold.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-84-customer-shipping-perf: manager → on-time shipping report', async () => {
    const snap = await runMerge(
      harness,
      'manager',
      'On-time shipping performance report.',
      'SELECT order_code, status, customer_code FROM sales_orders',
      'SELECT sku, location_code, quantity_on_hand FROM inventory',
      'Estimate on-time shipping performance by joining shipped orders with warehouse stock.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-85-sku-margin-analysis: director → margin-by-SKU', async () => {
    const snap = await runMerge(
      harness,
      'director',
      'SKU margin analysis: sales prices vs warehouse cost.',
      'SELECT order_code, customer_code, subtotal FROM sales_orders',
      'SELECT sku, location_code, quantity_on_hand FROM inventory',
      'Estimate per-SKU margin from sales subtotal vs warehouse cost proxy.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-86-quarterly-forecast: vp → sales+warehouse+frontier-trends', async () => {
    const snap = await runMerge(
      harness,
      'vp',
      'Quarterly forecast combining sales, warehouse, and frontier trends.',
      'SELECT order_code, customer_code, subtotal FROM sales_orders',
      'SELECT sku, quantity_on_hand FROM inventory',
      'Cross-reference the two pulls with current macroeconomic frontier trends and forecast Q3.',
      { frontier: true }
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-87-anomaly-detect: sr_manager → refunds vs returns anomalies', async () => {
    const snap = await runMerge(
      harness,
      'sr_manager',
      'Detect refund/return anomalies.',
      'SELECT order_code, status, subtotal FROM sales_orders',
      'SELECT sku, quantity_on_hand FROM inventory',
      'Identify anomalies in refunded/returned orders vs inventory movement.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-88-supply-chain-snapshot: director → board snapshot', async () => {
    const snap = await runMerge(
      harness,
      'director',
      'Cross-system supply chain board snapshot.',
      'SELECT order_code, status FROM sales_orders LIMIT 25',
      'SELECT sku, location_code, quantity_on_hand FROM inventory LIMIT 25',
      'Produce a one-page board snapshot of the supply chain.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-89-margin-by-region: vp → margin per region', async () => {
    const snap = await runMerge(
      harness,
      'vp',
      'Margin per region.',
      'SELECT order_code, customer_code, subtotal FROM sales_orders',
      'SELECT sku, location_code FROM inventory',
      'Compute margin per region using location-code grouping.'
    );
    assertMergeEnvelope(snap);
  }, 360_000);

  it('E2E-90-cross-system-audit: ceo → reconciliation report via secure_rails', async () => {
    const snap = await runMerge(
      harness,
      'ceo',
      'Cross-system audit reconciliation report.',
      'SELECT order_code, customer_code, subtotal FROM sales_orders',
      'SELECT sku, location_code, quantity_on_hand FROM inventory',
      'Reconcile sales-finance and warehouse data and produce a reconciliation_v1 report.'
    );
    assertMergeEnvelope(snap);
    const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
    expect(assembly, 'compile_assembly_complete must fire').toBeDefined();
    const detail = assembly!.detail as Record<string, unknown>;
    expect(detail['templateId'], 'reconciliation_v1 contract template').toBe('reconciliation_v1');
  }, 360_000);
});
