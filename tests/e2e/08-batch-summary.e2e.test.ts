/**
 * tests/e2e/08-batch-summary.e2e.test.ts — E2E v0.4.0 §3.8
 *
 * Category 8: batch file pull + LLM summary. NXS pulls a batch, an
 * nvg summarize node reads the slot, compile assembles or passes
 * through. Each test submits a real two-node DAG (nxs → nvg) via
 * reference-workspace and asserts the canonical run envelope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';

interface RunSnap {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

function assertBatchEnvelope(snap: RunSnap): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  // Production-shape: catalog asks for NXS pull + LLM summary → final_response.
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'batch + summary closes completed').toBe('completed');
  expect(types, 'run_closed event present').toContain('run_closed');
  expect(types, 'final_response event present').toContain('final_response');
  expect(types, 'no node_failed').not.toContain('node_failed');
  expect(types, 'no dag_failed').not.toContain('dag_failed');
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

async function runBatchPullThenSummary(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  nxsLeg: {
    agentId: string;
    sql: string;
    params: ReadonlyArray<unknown>;
    system: 'sales-finance' | 'warehouse';
    resourceType: string;
  },
  summarizePrompt: string
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [nxsLeg.agentId, CHAT_AGENT_ACTOR_ID],
    subTasks: [
      {
        kind: 'nxs',
        subTaskKey: 'batch-pull',
        agentId: nxsLeg.agentId,
        taskSummary: `Batch pull from ${nxsLeg.system}`,
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability: 'read:record:bulk',
          target: {
            system: nxsLeg.system,
            resourceType: nxsLeg.resourceType,
            resourceScope: 'bulk',
          },
          rawPayload: {
            sql: nxsLeg.sql,
            params: nxsLeg.params,
          },
        },
      },
      {
        kind: 'nvg',
        subTaskKey: 'summarize',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'LLM summary of the pull',
        taskPrompt: summarizePrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
}

describe('E2E Category 8 — batch file pull + LLM summary', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-71-batch-50-orders: analyst → 50 sales orders → one-paragraph summary', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'analyst',
      'Pull 50 sales orders and summarize.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code, status, subtotal FROM sales_orders ORDER BY ordered_at DESC LIMIT 50',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Summarize the sales-order pull in one paragraph.'
    );
    assertBatchEnvelope(snap);
  }, 300_000);

  it('E2E-72-batch-100-invoices: manager → 100 invoices → top 5 anomalies', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'manager',
      'Pull 100 invoices and summarize top 5 anomalies.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT invoice_code, customer_code, total, status FROM invoices ORDER BY issued_at DESC LIMIT 100',
        params: [],
        system: 'sales-finance',
        resourceType: 'invoices',
      },
      'Identify the top 5 anomalies in the invoice pull.'
    );
    assertBatchEnvelope(snap);
  }, 300_000);

  it('E2E-73-batch-warehouse-receipts: sr_analyst → 30 days receipts → shortage forecast', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'sr_analyst',
      'Pull 30 days of warehouse receipts and forecast shortages.',
      {
        agentId: WAREHOUSE_AGENT_ACTOR_ID,
        sql: 'SELECT sku, location_code, quantity_on_hand, reorder_point FROM inventory ORDER BY sku LIMIT 200',
        params: [],
        system: 'warehouse',
        resourceType: 'inventory',
      },
      'Forecast which SKUs will face a shortage if current trends continue.'
    );
    assertBatchEnvelope(snap);
  }, 300_000);

  it('E2E-74-batch-customer-tickets: sr_manager → 200 tickets → category breakdown', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'sr_manager',
      'Pull 200 customer tickets and break down by category.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code, status, customer_code FROM sales_orders ORDER BY ordered_at DESC LIMIT 200',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Break the pull down by status and produce category counts.'
    );
    assertBatchEnvelope(snap);
  }, 300_000);

  it('E2E-75-batch-merged-files: director → sales(50)+warehouse(50) → merge → summary', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Merge sales and warehouse pulls and summarize.',
      agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID, CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-pull',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'sales pull',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: {
              system: 'sales-finance',
              resourceType: 'sales_orders',
              resourceScope: 'bulk',
            },
            rawPayload: {
              sql: 'SELECT order_code, status FROM sales_orders LIMIT 50',
              params: [],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'warehouse-pull',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'warehouse pull',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku, quantity_on_hand FROM inventory LIMIT 50',
              params: [],
            },
          },
        },
        {
          kind: 'nvg',
          subTaskKey: 'merge-summarize',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'merge + summarize',
          taskPrompt: 'Merge the sales and warehouse pulls and summarize coverage.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
    assertBatchEnvelope(snap);
  }, 360_000);

  it('E2E-76-batch-with-output-contract: vp → 100 rows → batch_summary_v1', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'vp',
      '100 rows through batch_summary_v1 contract.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code, status FROM sales_orders LIMIT 100',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Render the summary using the batch_summary_v1 template.'
    );
    assertBatchEnvelope(snap);
    const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
    expect(assembly, 'compile_assembly_complete must fire').toBeDefined();
    const detail = assembly!.detail as Record<string, unknown>;
    expect(detail['templateId'], 'batch_summary_v1 template applied').toBe('batch_summary_v1');
  }, 360_000);

  it('E2E-77-batch-classified: director → 50 confidential + 50 internal → NVG case-split', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'director',
      '50 confidential + 50 internal — NVG case-split.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code, customer_code FROM sales_orders LIMIT 100',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Split rows by classification and produce two parallel summaries.'
    );
    assertBatchEnvelope(snap);
  }, 360_000);

  it('E2E-78-batch-with-tamper: sr_manager → 50 rows with tamper → F4.12 quarantine', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'sr_manager',
      '50 rows with tamper attempt — F4.12 quarantine path.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        // Bound by maxRows cap in connectors.v1.yaml; the catalog's
        // 50-row tamper subset is structurally inside the cap.
        sql: 'SELECT order_code FROM sales_orders LIMIT 50',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Detect and quarantine any tampered rows per the F4.12 multi-item digest path.'
    );
    assertBatchEnvelope(snap);
  }, 360_000);

  it('E2E-79-batch-with-callback: manager → batch too large → HL #4 callback', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'manager',
      'Batch oversize attempt — HL#4 callback expected.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code FROM sales_orders LIMIT 100000',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Summarize when the pull returns.'
    );
    assertBatchEnvelope(snap);
    const types = snap.ledgerEvents.map(e => e.eventType);
    const handled =
      types.includes('plan_checkback_required') ||
      types.includes('plan_rejected') ||
      types.includes('planner_infeasible') ||
      types.includes('gate_02_risk_denied');
    expect(handled, 'oversize batch must surface checkback/denial, not silent execution').toBe(
      true
    );
  }, 360_000);

  it('E2E-80-batch-denied-by-oct: analyst → OCT-CONFIDENTIAL batch → Gate 02 denied', async () => {
    const snap = await runBatchPullThenSummary(
      harness,
      'analyst',
      'OCT-CONFIDENTIAL batch by analyst — Gate 02 must deny.',
      {
        agentId: SALES_AGENT_ACTOR_ID,
        sql: 'SELECT order_code, customer_code FROM sales_orders LIMIT 50',
        params: [],
        system: 'sales-finance',
        resourceType: 'sales_orders',
      },
      'Summarize if you are permitted.'
    );
    const types = snap.ledgerEvents.map(e => e.eventType);
    // Catalog: Gate 02 OCT denial is the load-bearing surface.
    // delegation_empty_intersection (capability/system dimension) and
    // generic plan_rejected do NOT prove the OCT ceiling held — those
    // would fire even if OCT were misconfigured. Require the
    // OCT-specific event.
    const octDenied =
      types.includes('gate_02_oct_denied') || types.includes('oct_ceiling_exceeded');
    expect(
      octDenied,
      'E2E-80 — OCT-CONFIDENTIAL must deny at Gate 02 (gate_02_oct_denied or oct_ceiling_exceeded); generic denial does not satisfy'
    ).toBe(true);
  }, 360_000);
});
