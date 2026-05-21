/**
 * tests/e2e/03-nxs-single.e2e.test.ts — E2E v0.4.0 §3.3
 *
 * Category 3: single-agent NXS dispatch to a target system. Tests
 * span the 10-user capability ladder so denial differentials at
 * Gate 02 / 03 / 04 are explicit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BRIDGE_BLOCKER = 'NXS-DISPATCH-BRIDGE-RETURNS-NULL';

function nxsBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'PRODUCT_RUNTIME',
    reason: `NXS dispatch bridge returns null on the connector path (see E2E-23). Scenario: ${scenario}.`,
    blockedBy: BRIDGE_BLOCKER,
    owner: 'arch',
    lawPins,
    suspectedRootCause:
      'scripts/nexus-main.ts NXS dispatch bridge — finalOutcome=error_dispatch, evidence had no executionResult',
    nextRecommendedAction: 'Fix the bridge first. Then write the scenario body.',
  });
}

const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';

describe('E2E Category 3 — single-agent NXS dispatch (target system read)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-21-nxs-sales-list-orders: analyst → last 7 days of sales orders', () => {
    nxsBlocked('E2E-21', 'analyst sales-orders 7-day list', ['HL#5', 'HL#11']);
  });
  it('E2E-22-nxs-sales-by-customer: analyst → acme-corp orders last month', () => {
    nxsBlocked('E2E-22', 'analyst sales by-customer query', ['HL#5', 'HL#11']);
  });

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
    const executedActions = nxsActions.filter(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === 'executed'
    );
    expect(
      executedActions.length,
      'at least one nxs_action with finalOutcome=executed (warehouse connector actually ran)'
    ).toBeGreaterThan(0);
    // Compile produced a final response artifact.
    expect(types).toContain('final_response');
  }, 120_000);

  it('E2E-24-nxs-warehouse-low-stock: sr_analyst → SKUs under 50 qty', () => {
    nxsBlocked('E2E-24', 'sr_analyst warehouse low-stock query', ['HL#5', 'HL#11']);
  });
  it('E2E-25-nxs-sales-top-customers: manager → top 10 by revenue last quarter', () => {
    nxsBlocked('E2E-25', 'manager top-customers report', ['HL#5', 'HL#11']);
  });
  it('E2E-26-nxs-sales-bulk-pull: sr_manager → Q1 export bulk pull', () => {
    nxsBlocked('E2E-26', 'sr_manager bulk export — risk-ceiling test', ['HL#5', 'HL#10']);
  });
  it('E2E-27-nxs-warehouse-reorder-list: director → reorder this week by velocity', () => {
    nxsBlocked('E2E-27', 'director reorder by velocity', ['HL#5', 'HL#11']);
  });
  it('E2E-28-nxs-sales-delete-denied-for-analyst: analyst → delete ORD-12345 → Gate 03 denied', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-28',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'Gate 03 denial fires BEFORE bridge dispatch, so this test does NOT need the bridge fixed. Body not written.',
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'builder',
      lawPins: ['HL#5'],
      nextRecommendedAction:
        'Post analyst delete run against sales-orders; assert Gate 03 denial with capability_missing BEFORE any connector call.',
    });
  });
  it('E2E-29-nxs-warehouse-update-bulk-allowed-for-manager: manager → mark batch shipped', () => {
    nxsBlocked('E2E-29', 'manager bulk update', ['HL#5', 'HL#11']);
  });
  it('E2E-30-nxs-sales-delete-allowed-for-vp: vp → delete duplicate order → Gate 05 approval', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-30',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Gate 05 approval flow not exercised end-to-end via HTTP. Needs approval harness helper.',
      blockedBy: 'E2E-APPROVAL-FLOW-V1',
      owner: 'builder',
      lawPins: ['HL#5', 'HL#15'],
    });
  });
});
