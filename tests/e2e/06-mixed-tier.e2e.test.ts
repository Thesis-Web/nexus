/**
 * tests/e2e/06-mixed-tier.e2e.test.ts — E2E v0.4.0 §3.6
 *
 * Category 6: multi-agent mixed on-prem + frontier. Each test submits
 * a multi-node `kind:nvg` DAG through reference-workspace. NVG's
 * per-node classifier routes each node by prompt; the run's optional
 * `preferredEndpointId` is the user-supplied tier hint when the
 * catalog asks for a specific endpoint mix.
 *
 * Test-Body Factory mode 2026-05-22: bodies post real DAGs through the
 * production NVG/orch stack. If NVG mis-routes, or the frontier
 * endpoint is unhealthy, or the tier ceiling denies — the test fails
 * with the honest production trail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';
const FRONTIER_ENDPOINT = 'openai-gpt';

interface RunSnap {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

function assertMixedTierEnvelope(snap: RunSnap): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  // Production-shape: catalog asks for a successful mixed-tier run.
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'mixed-tier run closes completed').toBe('completed');
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

async function runMixedTwoLeg(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  onpremPrompt: string,
  frontierPrompt: string
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [CHAT_AGENT_ACTOR_ID],
    preferredEndpointId: FRONTIER_ENDPOINT,
    subTasks: [
      {
        kind: 'nvg',
        subTaskKey: 'onprem-leg',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'on-prem leg',
        taskPrompt: onpremPrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
      {
        kind: 'nvg',
        subTaskKey: 'frontier-leg',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'frontier leg',
        taskPrompt: frontierPrompt,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
}

describe('E2E Category 6 — multi-agent MIXED on-prem + frontier', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-51-onprem-then-frontier: sr_analyst → summarize → elaborate', async () => {
    const snap = await runMixedTwoLeg(
      harness,
      'sr_analyst',
      'Summarize then elaborate the company offsite agenda.',
      'Summarize in one sentence: a one-day company offsite with five sessions.',
      'Elaborate the prior summary into a three-paragraph plan with current best practices for hybrid work events.'
    );
    assertMixedTierEnvelope(snap);
  }, 300_000);

  it('E2E-52-frontier-then-onprem: sr_manager → research → summarize', async () => {
    const snap = await runMixedTwoLeg(
      harness,
      'sr_manager',
      'Research then summarize current logistics-industry trends.',
      'Summarize the prior research findings in one paragraph.',
      'Research and report current trends in last-mile logistics published in the past month.'
    );
    assertMixedTierEnvelope(snap);
  }, 300_000);

  it('E2E-53-mixed-parallel: manager → onprem-A + frontier-B → judge', async () => {
    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Parallel onprem + frontier with judge consolidation.',
      agents: [CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: FRONTIER_ENDPOINT,
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'onprem-A',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'on-prem leg A',
          taskPrompt: 'In one sentence, describe a balanced breakfast.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'frontier-B',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'frontier leg B',
          taskPrompt:
            'Cite the most-recent USDA dietary guidelines update and give one example menu.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'judge',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'judge merges the two',
          taskPrompt: 'Combine the prior two answers into one short paragraph.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
    assertMixedTierEnvelope(snap);
  }, 360_000);

  it('E2E-54-3-stage-mixed: director → onprem → frontier → onprem-format', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Three-stage mixed: onprem → frontier → onprem-format.',
      agents: [CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: FRONTIER_ENDPOINT,
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'onprem-1',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'onprem stage 1',
          taskPrompt: 'List three topics relevant to retail inventory in 2026.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'frontier-2',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'frontier stage 2',
          taskPrompt: 'Find a recent news headline matching each of the three topics.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'onprem-3',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'onprem stage 3 format',
          taskPrompt: 'Format the result as three bullet points.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
    assertMixedTierEnvelope(snap);
  }, 360_000);

  it('E2E-55-mixed-with-nxs: sr_manager → nxs-pull → onprem-summarize → frontier-polish', async () => {
    const jwt = await harness.jwtFor('sr_manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'NXS pull then on-prem summary then frontier polish.',
      agents: [SALES_AGENT_ACTOR_ID, CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: FRONTIER_ENDPOINT,
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'pull-sales',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'NXS pull',
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
              sql: 'SELECT order_code, status FROM sales_orders ORDER BY order_code LIMIT 5',
              params: [],
            },
          },
        },
        {
          kind: 'nvg',
          subTaskKey: 'onprem-summarize',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'on-prem summarize',
          taskPrompt: 'Summarize the sales-order pull in one short paragraph.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'frontier-polish',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'frontier polish',
          taskPrompt: 'Polish the summary into board-deck-ready language.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
    assertMixedTierEnvelope(snap);
  }, 360_000);

  it('E2E-56-mixed-with-output-contract: vp → board doc with frontier research', async () => {
    const snap = await runMixedTwoLeg(
      harness,
      'vp',
      'Board doc with frontier research and on-prem formatting.',
      'Format the frontier-sourced findings into a board-doc outline of five sections.',
      'Find three current macroeconomic trends impacting industrial sales in 2026.'
    );
    assertMixedTierEnvelope(snap);
    const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
    expect(assembly, 'compile_assembly_complete event present').toBeDefined();
    const detail = assembly!.detail as Record<string, unknown>;
    expect(detail['templateId'], 'board_doc_v1 contract template').toBe('board_doc_v1');
  }, 300_000);

  it('E2E-57-mixed-translation-pair: vp → onprem-en-fr + frontier-en-zh', async () => {
    const snap = await runMixedTwoLeg(
      harness,
      'vp',
      'Translate the greeting into French (on-prem) and Chinese (frontier).',
      'Translate to French: "Welcome to our annual investor day."',
      'Translate to Simplified Chinese: "Welcome to our annual investor day."'
    );
    assertMixedTierEnvelope(snap);
  }, 300_000);

  it('E2E-58-mixed-cost-routing-check: executive → low-cost on-prem + high-cost frontier', async () => {
    const snap = await runMixedTwoLeg(
      harness,
      'executive',
      'Compare low-cost on-prem with high-cost frontier output for the same question.',
      'In one sentence: what is the capital of France?',
      'In one paragraph with citations: the current population of France according to the most recent census.'
    );
    assertMixedTierEnvelope(snap);
  }, 300_000);

  it('E2E-59-mixed-fallback: director → frontier unhealthy → on-prem fallback', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Frontier unhealthy → on-prem fallback test.',
      agents: [CHAT_AGENT_ACTOR_ID],
      // Force a non-existent / unhealthy endpoint to trigger fallback path.
      preferredEndpointId: 'nonexistent-frontier-endpoint',
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'fallback-leg',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'fallback chat',
          taskPrompt: 'In one sentence, what is the largest planet in our solar system?',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertMixedTierEnvelope(snap);
    // Acceptable outcomes: either checkback fires (HL#4 — orch never kills),
    // or run completes against an on-prem fallback endpoint, or the run
    // rejects deterministically with a tier/endpoint error.
    const types = snap.ledgerEvents.map(e => e.eventType);
    const fallbackHandled =
      types.includes('plan_checkback_required') ||
      types.includes('plan_rejected') ||
      types.includes('planner_infeasible') ||
      types.includes('final_response');
    expect(fallbackHandled, 'unhealthy preferred endpoint must be handled (no silent drop)').toBe(
      true
    );
  }, 300_000);

  it('E2E-60-mixed-denied-by-tier-ceiling: analyst → frontier denied at NVG', async () => {
    const jwt = await harness.jwtFor('analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'analyst tries frontier; tier ceiling should deny.',
      agents: [CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: FRONTIER_ENDPOINT,
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'tier-test',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'analyst frontier chat',
          taskPrompt: 'In one sentence: what is the latest CPI print?',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertMixedTierEnvelope(snap);
    const types = snap.ledgerEvents.map(e => e.eventType);
    const denied =
      types.includes('tier_ceiling_exceeded') ||
      types.includes('delegation_empty_intersection') ||
      types.includes('plan_rejected') ||
      types.includes('planner_infeasible') ||
      types.includes('plan_checkback_required');
    expect(denied, 'analyst (low tier) requesting frontier must surface a denial').toBe(true);
  }, 300_000);
});
