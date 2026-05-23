/**
 * tests/e2e/07-branching.e2e.test.ts — E2E v0.4.0 §3.7
 *
 * Category 7: multi-agent branching DAGs (frontier → on-prem → multi →
 * compile). The deepest paths the wall exercises. Bodies submit
 * subTask DAGs through reference-workspace using sequential and
 * conditional edges where the production schema allows them.
 *
 * Test-Body Factory mode 2026-05-22: every slot has a runnable body;
 * production gaps surface as honest failures (dag_failed, missing
 * conditional-edge primitive, callback emitter absent, etc.).
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

function assertBranchingEnvelope(snap: RunSnap): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  // Production-shape: catalog asks for a successful branching DAG.
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'branching DAG closes completed').toBe('completed');
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

async function createBranching(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  subTasks: ReadonlyArray<unknown>,
  edges: ReadonlyArray<unknown> = []
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const agentSet = new Set<string>();
  for (const t of subTasks) {
    const obj = t as { agentId?: string };
    if (obj.agentId) agentSet.add(obj.agentId);
  }
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [...agentSet],
    preferredEndpointId: FRONTIER_ENDPOINT,
    subTasks,
    subTaskEdges: edges,
  });
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
}

describe('E2E Category 7 — multi-agent BRANCHING (frontier → on-prem → multi → compile)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-61-frontier-then-fan-out: sr_manager → frontier-survey → 3-agent fan-out', async () => {
    const snap = await createBranching(
      harness,
      'sr_manager',
      'Frontier survey then 3-agent fan-out.',
      [
        {
          kind: 'nvg',
          subTaskKey: 'frontier-survey',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'frontier survey',
          taskPrompt: 'Survey three current trends in supply-chain optimization.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        ...['focus-a', 'focus-b', 'focus-c'].map(k => ({
          kind: 'nvg',
          subTaskKey: k,
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: `fan-out leg ${k}`,
          taskPrompt: `Take one of the surveyed trends and elaborate it in one paragraph (${k}).`,
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        })),
      ]
    );
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-62-research-then-merge: director → frontier-news → extract+classify → merge', async () => {
    const snap = await createBranching(
      harness,
      'director',
      'Frontier research then extract+classify then merge.',
      [
        {
          kind: 'nvg',
          subTaskKey: 'research',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'research',
          taskPrompt: 'Find three current news items about logistics automation.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'extract',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'extract',
          taskPrompt: 'Extract the company names mentioned in the research.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'classify',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'classify',
          taskPrompt: 'Classify each company as startup, mid-cap, or large-cap.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'merge',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'merge',
          taskPrompt: 'Merge the classifications into a single sentence summary.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ]
    );
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-63-trend-detect-then-action: vp → frontier-trend → validate → action-plan', async () => {
    const snap = await createBranching(
      harness,
      'vp',
      'Frontier trend then validate then action plan.',
      [
        {
          kind: 'nvg',
          subTaskKey: 'trend',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'trend',
          taskPrompt: 'Identify one emerging trend in retail returns processing.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'validate',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'validate',
          taskPrompt: 'Validate the trend with one supporting data point.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'action',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'action plan',
          taskPrompt: 'Draft a three-step action plan to respond to the trend.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ]
    );
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-64-multi-loop-deep: executive → 4-deep on-prem chain', async () => {
    const snap = await createBranching(
      harness,
      'executive',
      '4-deep on-prem chain (same agent four times).',
      ['stage-1', 'stage-2', 'stage-3', 'stage-4'].map((k, i) => ({
        kind: 'nvg',
        subTaskKey: k,
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: `stage ${i + 1}`,
        taskPrompt: `Stage ${i + 1}: ${
          ['outline a project plan', 'expand the outline', 'identify risks', 'propose mitigations'][
            i
          ]
        }.`,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      }))
    );
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-65-branching-with-output: ceo → 4-agent + executive_briefing_v1', async () => {
    const snap = await createBranching(
      harness,
      'ceo',
      'Four-agent DAG rendered through executive_briefing_v1 contract.',
      ['leg-1', 'leg-2', 'leg-3', 'leg-4'].map((k, i) => ({
        kind: 'nvg',
        subTaskKey: k,
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: `briefing leg ${i + 1}`,
        taskPrompt: `Briefing leg ${i + 1}: ${
          [
            'macro context',
            'company-specific performance',
            'risk register',
            'strategic recommendations',
          ][i]
        }.`,
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      }))
    );
    assertBranchingEnvelope(snap);
    const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
    expect(assembly, 'compile_assembly_complete must fire').toBeDefined();
    const detail = assembly!.detail as Record<string, unknown>;
    expect(detail['templateId'], 'executive_briefing_v1 contract').toBe('executive_briefing_v1');
  }, 360_000);

  it('E2E-66-3-stage-with-callback: vp → ambiguous next-agent → callback (HL #4)', async () => {
    // Submit a 3-stage chain where stage 2 names an agent that does
    // not exist in the seed — the planner has no eligible candidate
    // and HL#4 requires a callback rather than a kill.
    const FAKE_AGENT_ID = '00000000-0000-4000-a000-aaaaaaaaaaaa';
    const jwt = await harness.jwtFor('vp');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Three-stage with deliberately-ambiguous next agent.',
      agents: [CHAT_AGENT_ACTOR_ID, FAKE_AGENT_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'stage-1',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'stage 1',
          taskPrompt: 'Outline a three-step procurement plan.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'stage-2',
          agentId: FAKE_AGENT_ID,
          taskSummary: 'ambiguous next agent',
          taskPrompt: 'Continue the plan.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'stage-3',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'stage 3',
          taskPrompt: 'Finalize the plan.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    // HL#4 explicit: ambiguity surfaces a CALLBACK (plan_checkback_required),
    // not a plan_rejected kill. plan_rejected is the kill path the
    // catalog is testing AGAINST. Accepting it here would encode the
    // bug as the expected behavior.
    expect(
      types,
      'HL#4 — ambiguous next agent MUST emit plan_checkback_required (callback, not kill)'
    ).toContain('plan_checkback_required');
  }, 300_000);

  it('E2E-67-branching-with-secure-rail: ceo → OCT-SECURE branch merges back', async () => {
    // Submit a branching DAG with a secure_handoff node — exercises
    // the OCT-aware merge-back path; expected red until OCT-SECURE
    // resources are seeded.
    const snap = await createBranching(harness, 'ceo', 'OCT-SECURE branch merges back.', [
      {
        kind: 'nvg',
        subTaskKey: 'public-arm',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'public arm',
        taskPrompt: 'Outline the public release notes.',
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
      {
        kind: 'secure_handoff',
        subTaskKey: 'secure-arm',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'secure arm',
        taskPrompt: 'Outline the OCT-SECURE compliance notes.',
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
      {
        kind: 'nvg',
        subTaskKey: 'merge',
        agentId: CHAT_AGENT_ACTOR_ID,
        taskSummary: 'merge',
        taskPrompt: 'Merge the two arms into one summary.',
        expectedOutputSlots: ['response'],
        inputSlotReads: [],
      },
    ]);
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-68-conditional-branch: director → judge picks downstream agent', async () => {
    const snap = await createBranching(
      harness,
      'director',
      'Judge picks downstream agent (conditional edge).',
      [
        {
          kind: 'nvg',
          subTaskKey: 'judge',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'judge picks downstream',
          taskPrompt: 'Pick one downstream branch: A or B.',
          expectedOutputSlots: ['choice'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'branch-a',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'branch A',
          taskPrompt: 'Write a paragraph if branch A was chosen.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'branch-b',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'branch B',
          taskPrompt: 'Write a paragraph if branch B was chosen.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ],
      [
        {
          sourceSubTaskKey: 'judge',
          targetSubTaskKey: 'branch-a',
          edgeType: 'conditional',
          conditionSpec: { sourceField: 'choice', operator: 'equals', value: 'A' },
          outputSlotRef: 'choice',
        },
        {
          sourceSubTaskKey: 'judge',
          targetSubTaskKey: 'branch-b',
          edgeType: 'conditional',
          conditionSpec: { sourceField: 'choice', operator: 'equals', value: 'B' },
          outputSlotRef: 'choice',
        },
      ]
    );
    assertBranchingEnvelope(snap);
  }, 360_000);

  it('E2E-69-second-run-trigger: vp → checkbackSourceRunId chain (HL #12)', async () => {
    // Run A: an ordinary chat that closes normally. Run B opens with
    // checkbackSourceRunId pointing to runA so HL#12 chain provenance
    // must be recorded.
    const jwt = await harness.jwtFor('vp');
    const { runId: runA } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Run A: chat baseline.',
      agents: [CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'run-a-chat',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'run a chat',
          taskPrompt: 'In one sentence: greet the team.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    await harness.waitForRunClosed(jwt, runA, { timeoutMs: 180_000 });

    // The current RunPostBody type omits checkbackSourceRunId from the
    // harness type; the underlying schema accepts it. Use a typed cast
    // limited to this test so the production schema's strict allow-list
    // is what governs whether the field is honored.
    const { runId: runB } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Run B: derived from Run A.',
      agents: [CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'run-b-chat',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'run b chat',
          taskPrompt: 'Follow up on the prior greeting.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
      checkbackSourceRunId: runA,
    } as unknown as Parameters<E2EHarness['createRun']>[1]);
    const snap = await harness.waitForRunClosed(jwt, runB, { timeoutMs: 240_000 });
    assertBranchingEnvelope(snap);
    const openEvent = snap.ledgerEvents.find(e => e.eventType === 'run_opened');
    expect(openEvent, 'run_opened present on Run B').toBeDefined();
    const chainEvents = snap.ledgerEvents.filter(
      e =>
        e.eventType === 'checkback_chain_recorded' ||
        (e.detail as Record<string, unknown>)['checkbackSourceRunId'] === runA
    );
    expect(chainEvents.length, 'HL#12 chain provenance recorded on Run B').toBeGreaterThan(0);
  }, 360_000);

  it('E2E-70-branching-with-output-contract-and-mixed-tier: ceo → board_doc_v1', async () => {
    const snap = await createBranching(
      harness,
      'ceo',
      'Deepest happy path: mixed-tier branches under board_doc_v1.',
      [
        {
          kind: 'nxs',
          subTaskKey: 'pull-sales',
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
              sql: 'SELECT order_code FROM sales_orders ORDER BY order_code LIMIT 3',
              params: [],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'pull-warehouse',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'warehouse pull',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku FROM inventory ORDER BY sku LIMIT 3',
              params: [],
            },
          },
        },
        {
          kind: 'nvg',
          subTaskKey: 'narrative',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'narrative',
          taskPrompt: 'Write a one-paragraph narrative tying the two pulls together.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'polish',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'frontier polish',
          taskPrompt: 'Polish into board-ready language.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ]
    );
    assertBranchingEnvelope(snap);
    const assembly = snap.ledgerEvents.find(e => e.eventType === 'compile_assembly_complete');
    expect(assembly, 'compile_assembly_complete must fire').toBeDefined();
    const detail = assembly!.detail as Record<string, unknown>;
    expect(detail['templateId'], 'board_doc_v1 contract').toBe('board_doc_v1');
  }, 360_000);
});
