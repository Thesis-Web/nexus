/**
 * tests/e2e/05-multi-with-contract.e2e.test.ts — E2E v0.4.0 §3.5
 *
 * Category 5: multi-agent runs WITH output contract templates. Each
 * body submits a multi-leg DAG under `promptMode: 'sectioned'` WITHOUT
 * a user pre-pick (no templateId / templateVersion in the request) —
 * exercising the planner-picks branch (outline §D: "Pick output
 * contract / compile template from template DB"). The planner consults
 * the prompt->templateId lexicon
 * (packages/planners/db-lexicon/src/output-contract-selector.ts); a
 * registered template (seeded at composition-root boot via
 * scripts/seeds/output-contract-templates.ts) is then loaded by the
 * renderer and the assembly event reports `passThrough: false` with
 * the resolved templateId.
 *
 * Tests for which a template + lexicon entry are NOT yet seeded stay
 * red — surfacing the per-template gap one row at a time as the
 * registry + selector table grow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';

async function runContractTwoLeg(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  expectedTemplateId: string
): Promise<void> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    // Phase 4 — sectioned tier exercises the planner-picks branch.
    // No templateId/templateVersion: the planner walks the
    // prompt->templateId lexicon and emits its choice on
    // ExecutionPlan.outputContractTemplateId. The renderer loads from
    // the registry; assembly fires with passThrough=false.
    promptMode: 'sectioned',
    prompt,
    agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID],
    subTasks: [
      {
        kind: 'nxs',
        subTaskKey: 'contract-sales',
        agentId: SALES_AGENT_ACTOR_ID,
        taskSummary: 'sales leg for contract',
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability: 'read:record:bulk',
          target: { system: 'sales-finance', resourceType: 'sales_orders', resourceScope: 'bulk' },
          rawPayload: {
            sql: 'SELECT order_code, customer_code, status FROM sales_orders ORDER BY order_code LIMIT 3',
            params: [],
          },
        },
      },
      {
        kind: 'nxs',
        subTaskKey: 'contract-warehouse',
        agentId: WAREHOUSE_AGENT_ACTOR_ID,
        taskSummary: 'warehouse leg for contract',
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability: 'read:record:bulk',
          target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
          rawPayload: {
            sql: 'SELECT sku, location_code, quantity_on_hand FROM inventory ORDER BY sku LIMIT 3',
            params: [],
          },
        },
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });

  const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
  expect(assembly, 'compile_assembly_complete must fire (compile ran)').toBeDefined();
  const detail = assembly!.detail as Record<string, unknown>;
  expect(
    detail['passThrough'],
    `contract '${expectedTemplateId}' must drive a real template (passThrough=false)`
  ).toBe(false);
  expect(detail['templateId'], `template id must equal '${expectedTemplateId}'`).toBe(
    expectedTemplateId
  );
}

describe('E2E Category 5 — multi-agent WITH output contract', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-41-table-monthly-sales: analyst → monthly_sales_table_v1', async () => {
    await runContractTwoLeg(
      harness,
      'sr_analyst',
      'Render a monthly sales table for the last quarter.',
      'monthly_sales_table_v1'
    );
  }, 240_000);

  it('E2E-42-prose-quarterly-review: manager → quarterly_review_prose_v1', async () => {
    await runContractTwoLeg(
      harness,
      'manager',
      'Write a quarterly review in prose using the sales and warehouse pulls.',
      'quarterly_review_prose_v1'
    );
  }, 240_000);

  it('E2E-43-mixed-prose-table: sr_manager → exec_report_mixed_v1', async () => {
    await runContractTwoLeg(
      harness,
      'sr_manager',
      'Produce an executive report combining prose narrative and a sales table.',
      'exec_report_mixed_v1'
    );
  }, 240_000);

  it('E2E-44-file-bundle: director → monthly_files_bundle_v1', async () => {
    await runContractTwoLeg(
      harness,
      'director',
      'Bundle the monthly snapshot files together.',
      'monthly_files_bundle_v1'
    );
  }, 240_000);

  it('E2E-45-guarded-confidential: vp → secure_report_v1 with OCT-guards', async () => {
    await runContractTwoLeg(
      harness,
      'vp',
      'Produce a guarded report with OCT-CONFIDENTIAL guards on every section.',
      'secure_report_v1'
    );
  }, 240_000);

  it('E2E-46-judge-decision-table: director → judge_decision_table_v1', async () => {
    await runContractTwoLeg(
      harness,
      'director',
      'Render a judge decision table from the two source pulls.',
      'judge_decision_table_v1'
    );
  }, 240_000);

  it('E2E-47-multi-source-merge: sr_manager → multi_source_merge_v1', async () => {
    await runContractTwoLeg(
      harness,
      'sr_manager',
      'Merge sales and warehouse rows into one report.',
      'multi_source_merge_v1'
    );
  }, 240_000);

  it('E2E-48-citation-formatted: vp → cited_research_v1 APA format', async () => {
    await runContractTwoLeg(
      harness,
      'vp',
      'Produce an APA-formatted research citation list.',
      'cited_research_v1'
    );
  }, 240_000);

  it('E2E-49-email-draft: sr_manager → email_draft_v1 with subjects', async () => {
    await runContractTwoLeg(
      harness,
      'sr_manager',
      'Draft an email summarizing the sales/warehouse status.',
      'email_draft_v1'
    );
  }, 240_000);

  it('E2E-50-financial-summary-template: executive → quarterly_financial_summary_v1', async () => {
    await runContractTwoLeg(
      harness,
      'executive',
      'Produce a quarterly financial summary using the configured template.',
      'quarterly_financial_summary_v1'
    );
  }, 240_000);
});
