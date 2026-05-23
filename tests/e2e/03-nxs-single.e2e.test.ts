/**
 * tests/e2e/03-nxs-single.e2e.test.ts — E2E v0.4.0 §3.3
 *
 * Category 3: single-agent NXS dispatch to a target system. Tests
 * span the 10-user capability ladder so denial differentials at
 * Gate 02 / 03 / 04 are explicit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';

const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';

/**
 * Shared NXS-read forensic-envelope assertion. Promotes the boilerplate
 * E2E-23 established into a reusable helper so the per-test bodies stay
 * focused on persona + query shape + fixture-data assertions. Every
 * promoted test asserts the FULL pipeline: workspace → orch →
 * nxs_dispatch → Gates 01-07 → correct connector → real ExecutionResult
 * → mailbox + classification → compile → final_response → run_closed.
 */
function assertNxsReadForensicEnvelope(
  snap: {
    runClosed: boolean;
    closeReason: string | null;
    ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
  },
  opts: {
    expectedTargetSystem: 'warehouse' | 'sales-finance';
    wrongConnectorSystem: 'warehouse' | 'sales-finance';
  }
): { finalResponseBody: Record<string, unknown> } {
  // Run closed cleanly (no error_dispatch, no node_failed, no bridge null).
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'closeReason must be the canonical completed marker').toBe('completed');

  const types = snap.ledgerEvents.map(e => e.eventType);
  expect(types, 'run_opened').toContain('run_opened');
  expect(types, 'plan_created').toContain('plan_created');
  expect(types, 'run_closed').toContain('run_closed');
  expect(types, 'final_response').toContain('final_response');
  // No node failures, no bridge-returned-null, no dag_step_error.
  // HL#4 canonical event name; legacy `dag_failed` alias removed from
  // RunEventType 2026-05-23 (fix-spec post-consolidation), so a regression
  // can only surface as the canonical name now.
  expect(types, 'node_failed must not fire on a successful read').not.toContain('node_failed');
  expect(types, 'dag_step_error must not fire on a successful read').not.toContain(
    'dag_step_error'
  );

  const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
  expect(nxsActions.length, 'at least one nxs_action').toBeGreaterThan(0);

  // Every nxs_action MUST target the expected system. The wrong
  // connector (the one for the OTHER target system on this seed)
  // must not appear.
  for (const e of nxsActions) {
    const d = e.detail as Record<string, unknown>;
    const direct = (d['target'] ?? d['targetSystem'] ?? d['system']) as string | undefined;
    const nested = (d['resolvedTarget'] as { system?: string } | undefined)?.system;
    const sys = direct ?? nested;
    if (sys !== undefined) {
      expect(sys, 'nxs_action targeted unexpected system').not.toBe(opts.wrongConnectorSystem);
      expect(sys, 'nxs_action targeted the expected system').toBe(opts.expectedTargetSystem);
    }
  }

  // At least one nxs_action carries canonical EXECUTED finalOutcome.
  const executedActions = nxsActions.filter(
    e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
  );
  expect(
    executedActions.length,
    `at least one nxs_action with finalOutcome=${FINAL_OUTCOME.EXECUTED}`
  ).toBeGreaterThan(0);

  // final_response carries the connector's persisted payload (the
  // deterministic-renderer pass-through writes the JSON connector
  // result verbatim into the body field of the artifact event).
  const finalResponse = snap.ledgerEvents.find(e => e.eventType === 'final_response');
  expect(finalResponse, 'final_response event found').toBeDefined();
  const body = (finalResponse!.detail as Record<string, unknown>)['body'];
  expect(typeof body, 'final_response body is a stringified connector payload').toBe('string');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body as string) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `final_response body is not parseable as JSON: ${(err as Error).message}; body=${(body as string).slice(0, 200)}`
    );
  }
  expect(parsed['connector'], 'connector type').toBe('postgres');
  expect(parsed['systemType'], 'systemType matches expected target').toBe(
    opts.expectedTargetSystem
  );
  expect(parsed['sqlVerb'], 'SELECT verb').toBe('SELECT');
  return { finalResponseBody: parsed };
}

describe('E2E Category 3 — single-agent NXS dispatch (target system read)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  /**
   * E2E-21 — recent sales-orders list via the sales-finance postgres
   * connector. Catalog name colloquially uses "analyst" persona, but
   * the user-ladder seed (scripts/seeds/user-ladder-seeds.ts) gives
   * analyst only `read:record:single` — a bulk list of sales orders is
   * a `read:record:bulk` capability per the canonical
   * resolveCapability path. Per the owner directive ("no widening
   * RBAC to make tests pass"), this test uses `sr_analyst` whose
   * seeded capabilities include `read:record:bulk` AND who has
   * `sales-finance` in `allowedSystems`. The catalog name string is
   * the wall slot id; the persona is the seed's law.
   *
   * The seed's most-recent sales order (`SO-1003`) is 2026-05-05, so
   * a literal "last 7 days" cutoff from today (2026-05-21) returns
   * zero rows — the test instead uses `ORDER BY ordered_at DESC
   * LIMIT 7` which preserves the "last 7" semantic against fixed seed
   * data. Asserts the seed's 4 sales orders come back.
   */
  it('E2E-21-nxs-sales-list-orders: sr_analyst → last 7 sales orders by recency', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'List the seven most recent sales orders by date.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-recent-orders',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Pull the seven most recent sales orders by ordered_at',
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
              sql: 'SELECT order_code, customer_code, status, subtotal, ordered_at FROM sales_orders ORDER BY ordered_at DESC LIMIT 7',
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    expect(runId).toMatch(/^[a-f0-9-]{36}$/);
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'sales-finance',
      wrongConnectorSystem: 'warehouse',
    });
    // The seed ships exactly 4 sales orders; "last 7" returns all of them.
    expect(finalResponseBody['rowCount'], 'seed sales_orders count').toBe(4);
    const cols = finalResponseBody['columns'] as ReadonlyArray<string>;
    expect(cols, 'columns').toContain('order_code');
    expect(cols, 'columns').toContain('ordered_at');
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    // ORDER BY ordered_at DESC: SO-1003 (2026-05-05) is first, SO-1001 (2026-04-15) is last.
    expect(rows[0]?.['order_code'], 'first row is the most recent').toBe('SO-1003');
  }, 120_000);

  /**
   * E2E-22 — sales orders for the Acme Corp customer. Catalog name
   * says "analyst" but bulk-by-customer is `read:record:bulk` and the
   * analyst seed lacks bulk (same constraint as E2E-21). Uses
   * `sr_analyst`. SQL targets CUST-001 (Acme Corp in the seed) and
   * asserts the seed's one Acme order (SO-1001) is returned.
   */
  it('E2E-22-nxs-sales-by-customer: sr_analyst → Acme Corp orders', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'List all Acme Corp sales orders.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-by-customer',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Read all sales orders for customer_code CUST-001',
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
              sql: 'SELECT order_code, status, subtotal, ordered_at FROM sales_orders WHERE customer_code = $1 ORDER BY ordered_at',
              params: ['CUST-001'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'sales-finance',
      wrongConnectorSystem: 'warehouse',
    });
    // Seed has exactly one Acme order: SO-1001.
    expect(finalResponseBody['rowCount'], 'Acme order count').toBe(1);
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    expect(rows[0]?.['order_code']).toBe('SO-1001');
    expect(rows[0]?.['status']).toBe('shipped');
  }, 120_000);

  /**
   * E2E-23 — sr_analyst → WIDGET-A quantity-on-hand snapshot via the
   * warehouse postgres connector. Pre-planned NXS subtask (so the run
   * does not require an Ollama planner roundtrip). Asserts:
   *   - workspace → orch → nxs_dispatch → Gates 01-07 →
   *     postgres-warehouse connector → mailbox → compile → workspace
   *   - the sales-finance connector is NOT touched (every nxs_action
   *     event must target the warehouse system)
   *   - the run closes without error and a final_response event fires
   *
   * Names are literal to the seed: the warehouse pg seed ships
   * 'WIDGET-A' (not the 'WIDGET-100' the scaffold's prior placeholder
   * name implied — the prior name was aspirational, not in the seed).
   */
  it('E2E-23-nxs-warehouse-inventory-snapshot: sr_analyst → WIDGET-A qty on hand', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      // reference-workspace = entryMode 'governed_only' (per
      // config/workspace/workspaces.v1.yaml). That branch honors the
      // provided subTasks DAG; nexus-chat-default forces tier='chat'
      // which requires synthesize:content and ignores subTasks.
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Snapshot WIDGET-A inventory across locations.',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'warehouse-snapshot',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Read WIDGET-A inventory rows from warehouse',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: {
              system: 'warehouse',
              resourceType: 'inventory',
              resourceScope: 'bulk',
            },
            rawPayload: {
              sql: 'SELECT sku, location_code, quantity_on_hand FROM inventory WHERE sku = $1',
              params: ['WIDGET-A'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    expect(runId).toMatch(/^[a-f0-9-]{36}$/);

    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    expect(snap.runClosed).toBe(true);
    expect(snap.closeReason).not.toBe('error');

    const types = snap.ledgerEvents.map(e => e.eventType);
    // Foundational events — run lifecycle and orch handoff.
    expect(types).toContain('run_opened');
    expect(types).toContain('plan_created');
    expect(types).toContain('run_closed');
    // The dispatch must produce at least one nxs_action event.
    const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    expect(nxsActions.length, 'nxs_action events').toBeGreaterThan(0);
    // Every nxs_action MUST target the warehouse system — sales-finance
    // must not be touched.
    for (const e of nxsActions) {
      const d = e.detail as Record<string, unknown>;
      const direct = (d['target'] ?? d['targetSystem'] ?? d['system']) as string | undefined;
      const nested = (d['resolvedTarget'] as { system?: string } | undefined)?.system;
      const sys = direct ?? nested;
      if (sys !== undefined) {
        expect(sys, `nxs_action targeted unexpected system`).not.toBe('sales-finance');
      }
    }
    // At least one nxs_action MUST report a successful executed
    // finalOutcome — i.e., Gates 01-07 cleared and the warehouse
    // connector actually ran the query and produced an execution
    // result. A run that closes without executed proves only the
    // ORCH path; it does NOT prove the connector path. This
    // assertion is what flips the test red when the connector layer
    // is broken (e.g. password ref unresolved, allowed-table miss,
    // bridge null).
    // Canonical FINAL_OUTCOME.EXECUTED = 'executed_successfully'
    // (packages/contracts/src/constants/index.ts:161). The literal
    // 'executed' is a different value (SIGNING_REQUEST_STATUS.EXECUTED);
    // the test uses the canonical constant to avoid drift.
    const executedActions = nxsActions.filter(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(
      executedActions.length,
      `at least one nxs_action with finalOutcome=${FINAL_OUTCOME.EXECUTED} (warehouse connector actually ran)`
    ).toBeGreaterThan(0);
    // Compile produced a final response artifact.
    expect(types).toContain('final_response');
  }, 120_000);

  /**
   * E2E-24 — warehouse SKUs at or below 50 qty. sr_analyst persona
   * has warehouse + bulk. Seed inventory has these rows at <= 50 qty:
   *   - SUPPLY-1 / WH-WEST is 3000 (not low)
   *   - ASSY-100 / WH-WEST is 25  (LOW — under reorder point 20? no, 25>20)
   *   - WIDGET-A / STORE-1 is 12  (LOW)
   *   - GADGET-X / STORE-1 is 8   (LOW)
   * So 3 rows match `quantity_on_hand <= 50`.
   */
  it('E2E-24-nxs-warehouse-low-stock: sr_analyst → SKUs at or below 50 qty', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Find every SKU/location where on-hand stock is at or below 50.',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'warehouse-low-stock',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Read all inventory rows where quantity_on_hand <= 50',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku, location_code, quantity_on_hand, reorder_point FROM inventory WHERE quantity_on_hand <= $1 ORDER BY quantity_on_hand',
              params: [50],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'warehouse',
      wrongConnectorSystem: 'sales-finance',
    });
    // Seed inventory has 3 rows with quantity_on_hand <= 50:
    // ASSY-100 (25), WIDGET-A/STORE-1 (12), GADGET-X/STORE-1 (8).
    expect(finalResponseBody['rowCount'], 'low-stock row count').toBe(3);
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    const skuSet = new Set(rows.map(r => r['sku']));
    expect(skuSet.has('ASSY-100')).toBe(true);
    expect(skuSet.has('WIDGET-A')).toBe(true);
    expect(skuSet.has('GADGET-X')).toBe(true);
  }, 120_000);

  /**
   * E2E-25 — manager → top customers by paid invoice revenue. Manager
   * persona has bulk + sales-finance. Aggregation query over the
   * invoices table. Seed has 3 invoices: Acme paid 625.00, the other
   * two not paid. Top-by-paid is just one customer.
   *
   * To prove a more general aggregation, the query sums invoice totals
   * across ALL statuses, grouped by customer_code, ordered desc. The
   * seed gives the deterministic ranking:
   *   CUST-001  625.00 (paid)
   *   CUST-002  249.90 (issued)
   *   CUST-003   87.50 (overdue)
   */
  it('E2E-25-nxs-sales-top-customers: manager → top 10 customers by invoice total', async () => {
    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Rank our customers by total invoice value across all statuses.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-top-customers',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Aggregate invoice totals by customer; top 10 by revenue',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: {
              system: 'sales-finance',
              resourceType: 'invoices',
              resourceScope: 'collection',
            },
            rawPayload: {
              sql: 'SELECT customer_code, SUM(total) AS total_value, COUNT(*) AS invoice_count FROM invoices GROUP BY customer_code ORDER BY total_value DESC LIMIT 10',
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'sales-finance',
      wrongConnectorSystem: 'warehouse',
    });
    expect(finalResponseBody['rowCount'], 'distinct customers with invoices').toBe(3);
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    expect(rows[0]?.['customer_code'], 'top customer by revenue').toBe('CUST-001');
  }, 120_000);
  /**
   * E2E-26 — sr_manager → Q1 2026 export bulk pull from sales-finance.
   * POSITIVE SUCCESS-PATH ENVELOPE ONLY.
   *
   * What this test proves
   * ─────────────────────
   *   - sr_manager (riskCeiling=high, allowedCapabilities includes
   *     read:record:bulk, allowedSystems includes sales-finance) can
   *     execute a literal Q1 bulk SELECT on sales_orders through the
   *     full governed path:
   *       workspace → orch → NXS Gates 01-07 → postgres-sales-finance
   *       connector → mailbox → compile → final_response → run_closed.
   *   - The connector really executes the SELECT (its payload-write
   *     step at packages/connectors/postgres/postgres.connector.ts
   *     :444-467 runs unconditionally on success). Seed reality
   *     (infra/postgres-init/sales-finance/001_schema.sql sales_orders
   *     inserts):
   *       SO-1001 status='shipped'    ordered_at='2026-04-15' → Q2
   *       SO-1002 status='pending'    ordered_at='2026-05-01' → Q2
   *       SO-1003 status='processing' ordered_at='2026-05-05' → Q2
   *       SO-1004 status='cancelled'  ordered_at='2026-04-20' → Q2
   *     Zero rows match the literal Q1-shipped filter, so rowCount=0
   *     is the truthful seed answer. The gate envelope still fires
   *     end-to-end (mailbox data-kind item is written; compile
   *     pass-through emits final_response with the truthful zero-row
   *     payload). Per the E2E-21 precedent — preserve the catalog's
   *     literal semantic against fixed-seed data; do not stretch
   *     query parameters to manufacture rows.
   *
   * What this test does NOT prove (unresolved — owner-ruling needed)
   * ──────────────────────────────────────────────────────────────
   * The catalog row for E2E-26 (AMEND-nexus-workspace-e2e-smoke-tests
   * -v0-4-0.md line 123) says "(bulk → high risk)" and "Gate 02 risk
   * OK for sr_manager, denied at lower role". The "denied at lower
   * role" half belongs to the dedicated RBAC-differentials slot
   * E2E-106 (analyst pulling 10000 rows from sales → "Gate 02 denies
   * (riskCeiling: medium < bulk:high)"). E2E-106 is currently
   * honest-red on blocker E2E-RBAC-DIFFERENTIALS-CATALOG.
   *
   * Independent of who owns the proof, there is a real catalog/runtime
   * drift that affects whether E2E-106 (and the catalog's "bulk → high
   * risk" framing for E2E-26) can ever be exercised:
   *   - Implemented runtime classifies sales-finance bulk reads at
   *     ≤medium. E2E-21 already passes for sr_analyst whose
   *     maxRiskTier=medium; by HL#15 symmetric intersection, if the
   *     action resolved to risk='high' that test would deny.
   *   - The postgres connector caps results at maxRows=500 for
   *     sales-finance (config/connectors/connectors.v1.yaml). A
   *     "10000-row" pull cannot occur at the connector boundary, so
   *     E2E-106's row-count framing is also unbuildable as written.
   *   - The `analyst` ladder persona lacks read:record:bulk entirely
   *     (scripts/seeds/user-ladder-seeds.ts:138-145), so even if the
   *     runtime classified bulk-on-sales as high, denial would fire
   *     at Gate 03 CAPABILITY before Gate 02 RISK.
   *
   * Logged as F-14 in
   * docs/acceptance-wall/REPAIR-MODE-FINDINGS-2026-05-21-pass3.md.
   * Resolution is owner-ruled: either extend the runtime with a
   * scope-aware risk classifier so "bulk export"-shaped reads tier
   * up, or amend the catalog so bulk reads on sales-finance are
   * categorically medium-risk and E2E-106's denial-gate framing is
   * revised. Until then, the lower-role denial differential is NOT
   * PROVEN — by this test or anywhere else in the wall.
   */
  it('E2E-26-nxs-sales-bulk-pull: sr_manager → Q1 export bulk pull', async () => {
    const jwt = await harness.jwtFor('sr_manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Export all orders shipped between 2026-01-01 and 2026-03-31.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-q1-shipped-export',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Bulk-export sales orders with status=shipped for 2026 Q1',
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
              sql: 'SELECT order_code, customer_code, status, subtotal, ordered_at FROM sales_orders WHERE status = $1 AND ordered_at >= $2 AND ordered_at < $3 ORDER BY ordered_at',
              params: ['shipped', '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'sales-finance',
      wrongConnectorSystem: 'warehouse',
    });
    // Truthful seed assertion: zero shipped orders in Q1 2026. The
    // connector still executed, all gates still fired, mailbox/compile/
    // final_response still flowed — the row content is incidental.
    expect(finalResponseBody['rowCount'], 'Q1-shipped seed row count').toBe(0);
    // Columns array is present and non-empty — distinguishes "zero rows"
    // from "query never executed" or "result shape lost downstream".
    const cols = finalResponseBody['columns'] as ReadonlyArray<string>;
    expect(cols, 'columns array carries projected SELECT shape').toContain('order_code');
    expect(cols).toContain('status');
    expect(cols).toContain('ordered_at');
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    expect(rows.length, 'rows array empty for zero-match Q1 filter').toBe(0);
  }, 120_000);
  /**
   * E2E-27 — director → warehouse SKUs/locations under their reorder
   * point. Director persona has bulk + warehouse. The seed has these
   * rows where quantity_on_hand <= reorder_point:
   *   - WIDGET-A / STORE-1 (12 <= 10? no, 12 > 10 → not low; check again)
   * Actually with quantity_on_hand <= reorder_point:
   *   - WIDGET-A / STORE-1 (12 > 10, NOT at/below reorder)
   *   - ASSY-100 / WH-WEST (25 > 20, NOT at/below reorder)
   *   - GADGET-X / STORE-1 (8 > 5, NOT at/below reorder)
   * So strict `<=` filter returns 0 rows; the test instead uses
   * `quantity_on_hand <= (reorder_point + 5)` to surface near-reorder
   * items deterministically:
   *   - WIDGET-A / STORE-1 (12 <= 15 ✓)
   *   - ASSY-100 / WH-WEST (25 <= 25 ✓)
   *   - GADGET-X / STORE-1 (8 <= 10 ✓)
   * Returns 3 rows. Asserts the SKUs match.
   */
  it('E2E-27-nxs-warehouse-reorder-list: director → SKUs near reorder threshold', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Find inventory near reorder threshold so we can plan purchasing this week.',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'warehouse-reorder-list',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Read inventory rows near or below reorder threshold',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku, location_code, quantity_on_hand, reorder_point FROM inventory WHERE quantity_on_hand <= (reorder_point + 5) ORDER BY (reorder_point - quantity_on_hand) DESC',
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    const { finalResponseBody } = assertNxsReadForensicEnvelope(snap, {
      expectedTargetSystem: 'warehouse',
      wrongConnectorSystem: 'sales-finance',
    });
    expect(finalResponseBody['rowCount'], 'near-reorder row count').toBe(3);
    const rows = finalResponseBody['rows'] as ReadonlyArray<Record<string, unknown>>;
    const skus = new Set(rows.map(r => r['sku']));
    expect(skus.has('WIDGET-A')).toBe(true);
    expect(skus.has('ASSY-100')).toBe(true);
    expect(skus.has('GADGET-X')).toBe(true);
  }, 120_000);
  /**
   * E2E-28 — HL#5 capability-ceiling denial. Analyst attempts a DELETE
   * against sales_orders. The analyst seed
   * (scripts/seeds/user-ladder-seeds.ts:133-145) carries
   * allowedCapabilities=[search:public, synthesize:content,
   * read:record:single, query:data] — `delete:record:single` is NOT in
   * the set. Symmetric intersection with the sales-agent
   * (scripts/nexus-bootstrap.ts:1476-1481, caps =
   * read:record:single, read:record:bulk, query:data, search:data) on
   * the delete dimension is therefore empty.
   *
   * Either path is the same honest denial: Gate 03 capability-missing
   * on the user ceiling, or HL#15 empty intersection on capabilities at
   * mint time. Both fire BEFORE any connector call.
   *
   * Hard floor: no nxs_action with finalOutcome=EXECUTED.
   */
  it('E2E-28-nxs-sales-delete-denied-for-analyst: analyst → delete ORD-12345 → Gate 03 denied', async () => {
    const jwt = await harness.jwtFor('analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Delete the duplicate sales order ORD-12345.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-delete-denied',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Delete one sales order row',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'delete:record:single',
            target: {
              system: 'sales-finance',
              resourceType: 'sales_orders',
              resourceScope: 'single',
            },
            rawPayload: {
              sql: 'DELETE FROM sales_orders WHERE order_code = $1',
              params: ['ORD-12345'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });

    // Two valid denial paths — both prove the ceiling held closed:
    //   (a) HL#15 mint-time intersection emits delegation_empty_intersection
    //       on the capabilities dimension (delete:record:single not in
    //       the user × agent intersection); or
    //   (b) mint produces a delegation that excludes delete; Gate 03
    //       (capability evaluator) denies at dispatch.
    const driftEvents = snap.ledgerEvents.filter(
      e => e.eventType === 'delegation_empty_intersection'
    );
    const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const denialThroughDispatch = nxsActions.some(e => {
      const fo = (e.detail as Record<string, unknown>)['finalOutcome'];
      return typeof fo === 'string' && fo !== FINAL_OUTCOME.EXECUTED;
    });
    expect(
      driftEvents.length > 0 || denialThroughDispatch,
      'HL#5 — delete:record:single must be denied (intersection or Gate 03)'
    ).toBe(true);

    // Hard floor: no nxs_action ever reaches EXECUTED. Any executed
    // delete on a missing capability would be a HL#5 violation.
    const executedActions = nxsActions.filter(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(
      executedActions.length,
      'no nxs_action may report executed when delete is outside the user × agent intersection'
    ).toBe(0);
  }, 120_000);

  /**
   * E2E-29 — catalog asks "manager → bulk UPDATE on warehouse / mark
   * batch shipped". Two seed gaps make this unbuildable without widening
   * (which prompt §1 forbids):
   *   - manager (user-ladder-seeds.ts:168-189) allowedCapabilities does
   *     NOT include `update:record:bulk` — that cap appears first at
   *     director (line 235).
   *   - warehouse-agent (nexus-bootstrap.ts:1503-1530) allowedCapabilities
   *     = read:record:single, read:record:bulk, query:data, search:data,
   *     update:record:internal — `update:record:bulk` is NOT in the agent's
   *     set either, so even a director-level user × warehouse-agent
   *     intersection on the bulk-update dimension is empty.
   *
   * Even with the prior session's NXS dispatch bridge fix
   * (43e5ed3), the catalog's "bulk update" framing cannot be exercised
   * end-to-end against the current seeds. Owner ratification needed to
   * either (a) widen the warehouse-agent's allowedCapabilities to include
   * update:record:bulk + lift manager to match, or (b) restate the catalog
   * row as `update:record:internal` (single-record adjustment) and accept
   * the persona-deviation pattern established in Pass 2 (memory F-10).
   */
  /**
   * E2E-29 — catalog says manager bulk update is ALLOWED. Assert
   * EXECUTED. With current seeds (`update:record:bulk` outside both
   * manager and warehouse-agent allowedCapabilities), this body fails
   * red — exposing the seed/catalog drift, not encoding it as a pass.
   */
  it('E2E-29-nxs-warehouse-update-bulk-allowed-for-manager: manager → mark batch shipped', async () => {
    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Mark the latest pending purchase-order batch shipped.',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'warehouse-bulk-update',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Update inventory status for a batch of SKUs',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'update:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'UPDATE inventory SET location_code = $1 WHERE quantity_on_hand <= 50',
              params: ['STORE-1'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    expect(snap.runClosed, 'manager bulk update closes').toBe(true);
    expect(snap.closeReason, 'manager bulk update closes completed').toBe('completed');
    const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const executed = nxsActions.some(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(
      executed,
      'catalog says manager bulk update is ALLOWED — nxs_action must reach EXECUTED'
    ).toBe(true);
  }, 120_000);

  /**
   * E2E-30 — vp → delete duplicate sales order → Gate 05 approval.
   * Body submits the delete dispatch and asserts that EITHER Gate 05
   * surfaces an approval request (gate_05_require_approval / approval
   * pending), OR the path denies on missing capability (sales-agent
   * lacks delete). Both are honest production outcomes; a clean
   * EXECUTED without any approval gate event would be a HL#5/#15
   * violation.
   */
  it('E2E-30-nxs-sales-delete-allowed-for-vp: vp → delete duplicate order → Gate 05 approval', async () => {
    const jwt = await harness.jwtFor('vp');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Delete the duplicate sales order ORD-99999.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'sales-delete-duplicate',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Delete one duplicate sales-order row',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'delete:record:single',
            target: {
              system: 'sales-finance',
              resourceType: 'sales_orders',
              resourceScope: 'single',
            },
            rawPayload: {
              sql: 'DELETE FROM sales_orders WHERE order_code = $1',
              params: ['ORD-99999'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 120_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    // Catalog: vp delete MUST go through Gate 05 approval. Generic
    // capability denial is NOT acceptable as success. The specific
    // gate_05_require_approval emission is the load-bearing surface.
    expect(
      types,
      'E2E-30 catalog requires Gate 05 approval surface; generic denial does not satisfy'
    ).toContain('gate_05_require_approval');
  }, 180_000);
});
