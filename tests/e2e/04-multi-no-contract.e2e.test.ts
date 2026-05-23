/**
 * tests/e2e/04-multi-no-contract.e2e.test.ts — E2E v0.4.0 §3.4
 *
 * Category 4: multi-agent runs without an output contract. Each test
 * posts a 2-node DAG through the governed `reference-workspace`. The
 * catalog rows name chat-style alias agents (analyst-bot, summary-bot,
 * etc.); since the bootstrap only seeds the default chat agent + the
 * two NXS read agents, the test-body factory pattern uses the seeded
 * agents in the same DAG shape the catalog asks for. Real failures
 * (delegation_empty_intersection on chat-agent disjoint allowedSystems,
 * dag_failed, missing slot, etc.) surface honestly through the
 * production pipeline.
 *
 * Test-Body Factory mode 2026-05-22: each test attempts the production
 * path through workspace → orch → NVG/NXS pipeline → mailbox → compile.
 * Assertions reject bridge-null / unsolicited-tool-call / silent-success
 * failure modes. Run-closed is required; the close reason carries the
 * real production verdict.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';

function assertMultiNoContractEnvelope(snap: {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  // Production-shape expectation: the catalog asks for a successful
  // multi-leg fan-out that closes with a final_response artifact.
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'multi-leg run closes completed').toBe('completed');
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

/**
 * Two-node chat fan-out body factory. Submits a `reference-workspace`
 * DAG with two `kind:nvg` nodes against the default chat agent. The
 * test asserts run_closed and that no fabricated fast-paths fired.
 */
async function runChatFanout(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  legAPrompt: string,
  legBPrompt: string
): Promise<{
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [CHAT_AGENT_ACTOR_ID],
    subTasks: [
      {
        kind: 'nvg',
        subTaskKey: 'chat-leg-a',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'first fan-out leg',
        taskPrompt: legAPrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
      {
        kind: 'nvg',
        subTaskKey: 'chat-leg-b',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'second fan-out leg',
        taskPrompt: legBPrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  expect(runId).toMatch(/^[a-f0-9-]{36}$/);
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
}

describe('E2E Category 4 — multi-agent, no output contract', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-31-multi-chat-fan-out: sr_analyst → analyst-bot + summary-bot', async () => {
    const snap = await runChatFanout(
      harness,
      'sr_analyst',
      'Brief me on Q1 sales trends and summarize for the team.',
      'Analyze Q1 sales trends in two sentences.',
      'Summarize the Q1 trends as a short headline.'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-32-multi-domain-experts: manager → finance-bot + ops-bot', async () => {
    const snap = await runChatFanout(
      harness,
      'manager',
      'Walk through the finance and operations sides of the new product launch.',
      'Financial considerations for launching a new product line.',
      'Operations considerations for launching a new product line.'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-33-multi-language-pair: sr_manager → english-bot + french-bot', async () => {
    const snap = await runChatFanout(
      harness,
      'sr_manager',
      'Greet the new team in both English and French.',
      'Compose a one-sentence English greeting for a new team member.',
      'Compose a one-sentence French greeting for a new team member.'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-34-multi-tone: director → formal-bot + casual-bot', async () => {
    const snap = await runChatFanout(
      harness,
      'director',
      'Announce the team offsite in both formal and casual tones.',
      'Formal one-sentence announcement of a team offsite next month.',
      'Casual one-sentence announcement of a team offsite next month.'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-35-multi-judge-format: director → response-bot + judge-bot', async () => {
    const snap = await runChatFanout(
      harness,
      'director',
      'Draft a response and have a judge score it.',
      'Draft a one-sentence response to a customer complaint about late shipment.',
      'Score the previous response 1-10 on empathy and clarity in one sentence.'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-36-multi-fact-fact-judge: vp → fact1-bot + fact2-bot + judge-bot', async () => {
    const jwt = await harness.jwtFor('vp');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Three-agent fact-fact-judge: two facts then a judge.',
      agents: [CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'fact-a',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'first fact',
          taskPrompt: 'State one fact about the boiling point of water at sea level.',
          expectedOutputSlots: ['fact'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'fact-b',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'second fact',
          taskPrompt: 'State one fact about the freezing point of water at sea level.',
          expectedOutputSlots: ['fact'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'judge',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'judge two facts',
          taskPrompt: 'Judge: are the two prior facts both correct?',
          expectedOutputSlots: ['verdict'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertMultiNoContractEnvelope(snap);
  }, 300_000);

  /**
   * E2E-37 — manager fans out two parallel NXS pulls (sales-finance +
   * warehouse) into the run's compile mailbox. Already bodied at
   * commit c6980e0 (post bridge fix). Kept here as the manager-persona
   * companion to E2E-116 multi-actor allocation.
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
    expect(
      ledger.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
      'no bridge-null events (43e5ed3 bridge fix held)'
    ).toBe(false);
    expect(
      ledger.some(e => e.eventType === 'error_dispatch'),
      'no error_dispatch (parallel pulls completed cleanly)'
    ).toBe(false);
    expect(types, 'node_failed must not fire on a clean parallel pull').not.toContain(
      'node_failed'
    );
    expect(types, 'dag_failed must not fire on a clean parallel pull').not.toContain('dag_failed');
    expect(types, 'dag_step_error must not fire on a clean parallel pull').not.toContain(
      'dag_step_error'
    );

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

    expect(types, 'final_response event present (compile assembled both legs)').toContain(
      'final_response'
    );
  }, 240_000);

  it('E2E-38-multi-translate-pair: sr_manager → en-fr + en-es', async () => {
    const snap = await runChatFanout(
      harness,
      'sr_manager',
      'Translate the welcome blurb into French and Spanish.',
      'Translate to French: "Welcome aboard. We are glad you joined the team."',
      'Translate to Spanish: "Welcome aboard. We are glad you joined the team."'
    );
    assertMultiNoContractEnvelope(snap);
  }, 240_000);

  it('E2E-39-multi-perspective-shootout: vp → exec/analyst/intern perspectives', async () => {
    const jwt = await harness.jwtFor('vp');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Three-perspective shootout on remote-work policy.',
      agents: [CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'exec-view',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'executive perspective',
          taskPrompt:
            'From an executive perspective, briefly argue for or against a 4-day work week.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'analyst-view',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'analyst perspective',
          taskPrompt:
            'From an analyst perspective, briefly argue for or against a 4-day work week.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'intern-view',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'intern perspective',
          taskPrompt: 'From an intern perspective, briefly argue for or against a 4-day work week.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertMultiNoContractEnvelope(snap);
  }, 300_000);

  /**
   * E2E-40 — bundle FinalResponseArtifact carries both items (F4.12
   * multi-item pass-through). The test asserts compile_assembly_complete
   * reports itemCount >= 2 (or fails red if multi-item assembly does
   * not run — F4.12 explicit gap).
   */
  it('E2E-40-multi-no-contract-bundle-shape: executive → bundle FinalResponseArtifact carries both items', async () => {
    const jwt = await harness.jwtFor('executive');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Two-item bundle shape check.',
      agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'bundle-sales',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'sales bundle item',
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
              sql: 'SELECT order_code FROM sales_orders ORDER BY order_code LIMIT 2',
              params: [],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'bundle-warehouse',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'warehouse bundle item',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku FROM inventory ORDER BY sku LIMIT 2',
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
    assertMultiNoContractEnvelope(snap);

    const compileAssembly = snap.ledgerEvents.find(
      e => e.eventType === 'compile_assembly_complete'
    );
    expect(compileAssembly, 'compile_assembly_complete event present').toBeDefined();
    const itemCount = (compileAssembly!.detail as Record<string, unknown>)['itemCount'];
    expect(itemCount, 'F4.12 — multi-item bundle assembles both items').toBe(2);
  }, 240_000);
});
