/**
 * tests/e2e/04-multi-no-contract.e2e.test.ts — E2E v0.4.0 §3.4
 *
 * Category 4: multi-agent runs without an output contract. Each agent
 * does its thing, results bundle into a multi-item FinalResponseArtifact
 * (HL #11 + F4.12 multi-item pass-through).
 *
 * Owner directive 2026-05-21: no `it.skip`. As of 2026-05-22, catalog
 * scenarios in this file call for chat-style agents (analyst-bot,
 * summary-bot, finance-bot, ops-bot, etc.) that do NOT exist as seeds —
 * the bootstrap (scripts/nexus-bootstrap.ts) seeds only one chat agent
 * (default, allowedSystems=['stub']) plus NXS read agents
 * (nexus-sales-agent, nexus-warehouse-agent). The session prompt
 * 2026-05-22 explicitly forbids inventing new agent seeds (per §11
 * "any other §3.B surface"), so every fan-out body that names a
 * not-yet-seeded chat agent stays surface-blocked until owner ratifies
 * the agent seed set.
 *
 * Note: even if those chat-agent seeds existed, the
 * CHAT-AGENT-LADDER-INTERSECTION-EMPTY blocker (surfaced by E2E-02..10
 * 2026-05-22) would still apply unless the new agents are seeded with
 * an allowedSystems set that intersects with the ladder personas'.
 *
 * E2E-37 is the one slot in this file that does NOT need new chat agents:
 * its catalog row asks for two parallel NXS pulls (sales + warehouse)
 * using the seeded NXS read agents, which works post bridge fix 43e5ed3
 * (verified in production by E2E-116 HL#8 mailbox isolation, which uses
 * the same 2-NXS-agent shape with sr_analyst). E2E-37 is bodied below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';

const BLOCKER = 'MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS';

function multiNoContractBlocked(
  testId: string,
  scenario: string,
  lawPins: ReadonlyArray<string>
): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'UNIMPLEMENTED_SURFACE',
    reason: `Multi-agent chat fan-out (${scenario}) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.`,
    blockedBy: BLOCKER,
    owner: 'owner',
    lawPins,
    nextRecommendedAction:
      "Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.",
  });
}

describe('E2E Category 4 — multi-agent, no output contract', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-31-multi-chat-fan-out: sr_analyst → analyst-bot + summary-bot', () => {
    multiNoContractBlocked('E2E-31', 'sr_analyst fans out chat to two on-prem chat agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-32-multi-domain-experts: manager → finance-bot + ops-bot', () => {
    multiNoContractBlocked('E2E-32', 'manager fan-out to two domain-expert agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-33-multi-language-pair: sr_manager → english-bot + french-bot', () => {
    multiNoContractBlocked('E2E-33', 'sr_manager fan-out to two language-pair agents', [
      'HL#8',
      'HL#11',
    ]);
  });
  it('E2E-34-multi-tone: director → formal-bot + casual-bot', () => {
    multiNoContractBlocked('E2E-34', 'director fan-out — tone differential', ['HL#8', 'HL#11']);
  });
  it('E2E-35-multi-judge-format: director → response-bot + judge-bot', () => {
    multiNoContractBlocked('E2E-35', 'director response + judge', ['HL#8', 'HL#11']);
  });
  it('E2E-36-multi-fact-fact-judge: vp → fact1-bot + fact2-bot + judge-bot', () => {
    multiNoContractBlocked('E2E-36', 'vp three-agent fact + fact + judge', ['HL#8', 'HL#11']);
  });
  /**
   * E2E-37 — manager fans out two parallel NXS pulls (sales-finance +
   * warehouse) into the run's compile mailbox.
   *
   * Catalog (AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md:140):
   *   manager / sales-pull-agent + warehouse-pull-agent / parallel NXS
   *   pulls, both into compile mailbox / HL #5 NXS sole action authority.
   *
   * Persona-deviation note: the catalog names two `*-pull-agent` aliases
   * for the same underlying NXS reads. The seeded equivalents are
   * `nexus-sales-agent` + `nexus-warehouse-agent` (the only NXS read
   * agents in the bootstrap). Per the F-10 persona-deviation pattern,
   * the test uses the seeded agents and the catalog persona (manager).
   * Manager (user-ladder-seeds.ts:168-189) has allowedSystems including
   * BOTH sales-finance AND warehouse, plus read:record:bulk and risk
   * ceiling 'high' — every dimension for the two pulls succeeds.
   *
   * Post-bridge-fix (43e5ed3) and verified by E2E-116 (HL#8 isolation,
   * sr_analyst + 2 NXS subTasks), the 2-NXS-agent parallel shape works
   * end-to-end. This body is the manager-persona companion focused on
   * the multi-no-contract bundle path (HL #5 NXS authority, not the
   * mailbox isolation E2E-116 already proves).
   */
  it('E2E-37-multi-2x-parallel-pull: manager → sales-pull + warehouse-pull', async () => {
    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Pull the current sales-order list and the WIDGET-A inventory snapshot.',
      agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'e2e37-sales-pull',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Read recent sales orders (sales-pull leg)',
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
              sql: 'SELECT order_code, status FROM sales_orders ORDER BY ordered_at DESC LIMIT 5',
              params: [],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'e2e37-warehouse-pull',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Read WIDGET-A inventory rows (warehouse-pull leg)',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
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

    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 120_000 });
    expect(snap.runClosed, 'run closed').toBe(true);
    expect(snap.closeReason, 'no-contract 2x parallel pull closes completed').toBe('completed');

    const ledger = snap.ledgerEvents;
    const types = ledger.map(e => e.eventType);
    expect(types, 'run_opened').toContain('run_opened');
    expect(types, 'plan_created').toContain('plan_created');
    expect(types, 'run_closed').toContain('run_closed');
    // Bridge-fix hard floor: no null returns, no error_dispatch.
    expect(
      ledger.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
      'no bridge-null events (43e5ed3 bridge fix held)'
    ).toBe(false);
    expect(
      ledger.some(e => e.eventType === 'error_dispatch'),
      'no error_dispatch (parallel pulls completed cleanly)'
    ).toBe(false);
    // No node failures either — both legs survive to compile.
    expect(types, 'node_failed must not fire on a clean parallel pull').not.toContain(
      'node_failed'
    );
    expect(types, 'dag_failed must not fire on a clean parallel pull').not.toContain('dag_failed');

    // Two NXS dispatches MUST occur — one per leg. The orch coordinator
    // emits at least one nxs_action per dispatched subtask; both must
    // reach EXECUTED to prove HL#5 (NXS is the sole action authority and
    // both authorized reads actually executed through it).
    const nxsActions = ledger.filter(e => e.eventType === 'nxs_action');
    const salesExecuted = nxsActions.some(e => {
      const d = e.detail as Record<string, unknown>;
      return d['target'] === 'sales-finance' && d['finalOutcome'] === FINAL_OUTCOME.EXECUTED;
    });
    const warehouseExecuted = nxsActions.some(e => {
      const d = e.detail as Record<string, unknown>;
      return d['target'] === 'warehouse' && d['finalOutcome'] === FINAL_OUTCOME.EXECUTED;
    });
    expect(salesExecuted, 'sales-finance leg reached EXECUTED').toBe(true);
    expect(warehouseExecuted, 'warehouse leg reached EXECUTED').toBe(true);

    // "Both into compile mailbox" — one per-actor mailbox per agentId,
    // both allocated. The run-coordinator emits one mailbox_allocated
    // event per unique plan.node.agentId (run-coordinator.ts:374-378).
    const allocs = ledger.filter(e => e.eventType === 'mailbox_allocated');
    expect(allocs.length, 'one mailbox_allocated per unique actor (sales + warehouse)').toBe(2);
    const salesAlloc = allocs.find(
      e => (e.detail as Record<string, unknown>)['actorId'] === SALES_AGENT_ACTOR_ID
    );
    const warehouseAlloc = allocs.find(
      e => (e.detail as Record<string, unknown>)['actorId'] === WAREHOUSE_AGENT_ACTOR_ID
    );
    expect(salesAlloc, 'sales-pull mailbox allocation present').toBeDefined();
    expect(warehouseAlloc, 'warehouse-pull mailbox allocation present').toBeDefined();

    // Compile assembled both legs into a final_response — the no-contract
    // multi-item compile path fires once and emits final_response on the
    // ledger. Anything less (final_response missing, or fired after a
    // node_failed) breaks the catalog row's "both into compile" promise.
    expect(types, 'final_response event present (compile assembled both legs)').toContain(
      'final_response'
    );
  }, 240_000);
  it('E2E-38-multi-translate-pair: sr_manager → en-fr + en-es', () => {
    multiNoContractBlocked('E2E-38', 'sr_manager translate pair', ['HL#8', 'HL#11']);
  });
  it('E2E-39-multi-perspective-shootout: vp → exec/analyst/intern perspectives', () => {
    multiNoContractBlocked('E2E-39', 'vp three-agent perspective shootout', ['HL#8', 'HL#11']);
  });
  it('E2E-40-multi-no-contract-bundle-shape: executive → bundle FinalResponseArtifact carries both items', () => {
    multiNoContractBlocked(
      'E2E-40',
      'executive bundle-shape assertion — two mailbox items → one multi-item artifact',
      ['HL#11', 'F4.12']
    );
  });
});
