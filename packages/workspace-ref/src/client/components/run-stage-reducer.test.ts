// CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §3 — pure-function tests for the run
// timeline reducer. No React, no jsdom — `computeRunTimeline` takes an
// array of RunEvent and returns RunTimelineState. We assert real behavior:
// stage statuses, failure surfacing, plan_review hide-on-auto-approve,
// graceful handling of unknown event types.

import { describe, it, expect } from 'vitest';
import { computeRunTimeline } from './run-stage-reducer.js';
import type { RunEvent } from '../hooks/use-run-events.js';

function ev(
  type: string,
  detail: Record<string, unknown> = {},
  timestamp = `2026-05-09T00:00:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}.000Z`
): RunEvent {
  return { type, runId: 'run-test', detail, timestamp };
}

const SUCCESS_EVENTS: RunEvent[] = [
  ev('run_opened', { promptDigest: 'abc' }, '2026-05-09T00:00:00.000Z'),
  ev('plan_created', { planId: 'p1', nodeCount: 1 }, '2026-05-09T00:00:01.000Z'),
  ev('plan_checkback_sent', { planId: 'p1' }, '2026-05-09T00:00:02.000Z'),
  ev('plan_confirmed', { planId: 'p1' }, '2026-05-09T00:00:03.000Z'),
  ev('orchestrator_dispatched', { selectedAgentCount: 1 }, '2026-05-09T00:00:04.000Z'),
  ev('delegation_issued', { delegationId: 'd1' }, '2026-05-09T00:00:05.000Z'),
  ev('node_dispatched', { nodeId: 'n1' }, '2026-05-09T00:00:06.000Z'),
  ev('partial_result', { mailboxItemId: 'm1', responseSize: 42 }, '2026-05-09T00:00:07.000Z'),
  ev('node_completed', {}, '2026-05-09T00:00:08.000Z'),
  ev('dag_completed', {}, '2026-05-09T00:00:09.000Z'),
  ev('compile_triggered', {}, '2026-05-09T00:00:10.000Z'),
  ev('compile_started', {}, '2026-05-09T00:00:11.000Z'),
  ev('compile_assembly_complete', {}, '2026-05-09T00:00:12.000Z'),
  ev('final_response', { artifactId: 'art1', body: 'final answer' }, '2026-05-09T00:00:13.000Z'),
  ev('run_closed', { closeReason: 'completed' }, '2026-05-09T00:00:14.000Z'),
];

describe('computeRunTimeline', () => {
  it('produces a closed, non-failing timeline for a successful auto-approved run', () => {
    const timeline = computeRunTimeline(SUCCESS_EVENTS);

    expect(timeline.closed).toBe(true);
    expect(timeline.failure).toBeNull();
    expect(timeline.runStartedAt).toBe('2026-05-09T00:00:00.000Z');
    expect(timeline.runEndedAt).toBe('2026-05-09T00:00:14.000Z');
    expect(timeline.finalResponseBody).toBe('final answer');
    expect(timeline.finalArtifactId).toBe('art1');

    const stageById = Object.fromEntries(timeline.stages.map(s => [s.id, s]));
    // The stages we care about all completed.
    expect(stageById['prompt_received']!.status).toBe('complete');
    expect(stageById['planning']!.status).toBe('complete');
    expect(stageById['delegation']!.status).toBe('complete');
    expect(stageById['nvg_wall']!.status).toBe('complete');
    expect(stageById['agent_response']!.status).toBe('complete');
    expect(stageById['compile']!.status).toBe('complete');
    expect(stageById['final_response']!.status).toBe('complete');
    expect(stageById['run_closed']!.status).toBe('complete');
  });

  it('marks plan_review as skipped (and event-empty) when checkback never fired', () => {
    // Auto-approved run: no plan_checkback_required / _resolved events.
    const timeline = computeRunTimeline(SUCCESS_EVENTS);

    const planReview = timeline.stages.find(s => s.id === 'plan_review');
    expect(planReview).toBeDefined();
    // The stage has zero events — the timeline component (run-timeline.tsx)
    // filters it from the rendered list when this is true.
    expect(planReview!.events.length).toBe(0);
    // The reducer status is whatever its skipped-with-later-events branch
    // produces. The contract for the renderer is `events.length === 0`,
    // not the literal status string — that's what we assert.
  });

  it('shows plan_review with content when a checkback actually fires', () => {
    const eventsWithCheckback: RunEvent[] = [
      ev('run_opened', {}, '2026-05-09T00:01:00.000Z'),
      ev('plan_created', { planId: 'p1' }, '2026-05-09T00:01:01.000Z'),
      ev('plan_checkback_sent', { planId: 'p1' }, '2026-05-09T00:01:02.000Z'),
      ev(
        'plan_checkback_required',
        {
          planDigest: 'pd1',
          primaryTier: 'frontier_general',
          primaryHealthy: false,
          fallbackTier: null,
          fallbackHealthy: false,
          alternativeTier: 'on_prem_general',
          alternativeEndpoint: {
            endpointId: 'ollama-jameshp',
            modelName: 'qwen2.5:1.5b',
            tier: 'on_prem_general',
          },
          message: 'Selected tier has no healthy endpoints',
          denialReason: null,
        },
        '2026-05-09T00:01:03.000Z'
      ),
      ev('plan_checkback_resolved', { decision: 'allow' }, '2026-05-09T00:01:04.000Z'),
      ev('plan_confirmed', { planId: 'p1' }, '2026-05-09T00:01:05.000Z'),
    ];

    const timeline = computeRunTimeline(eventsWithCheckback);
    const planReview = timeline.stages.find(s => s.id === 'plan_review')!;

    // Checkback events landed → stage is no longer empty and renders.
    expect(planReview.events.length).toBeGreaterThanOrEqual(2);
    // The 'allow' decision resolves the checkback successfully.
    expect(planReview.status).toBe('complete');
    // Pending-checkback state cleared once a resolution event arrives.
    expect(timeline.pendingCheckback).toBeNull();
  });

  it('surfaces a denied checkback as a denial on the plan_review stage', () => {
    const denyCheckbackEvents: RunEvent[] = [
      ev('run_opened', {}, '2026-05-09T00:02:00.000Z'),
      ev('plan_created', { planId: 'p2' }, '2026-05-09T00:02:01.000Z'),
      ev('plan_checkback_required', { message: 'Tier unhealthy' }, '2026-05-09T00:02:02.000Z'),
      ev(
        'plan_checkback_resolved',
        { decision: 'deny', reason: 'user_denied' },
        '2026-05-09T00:02:03.000Z'
      ),
      ev('plan_rejected', { reason: 'user_rejected_plan' }, '2026-05-09T00:02:04.000Z'),
      ev('run_closed', { closeReason: 'user_cancelled' }, '2026-05-09T00:02:05.000Z'),
    ];

    const timeline = computeRunTimeline(denyCheckbackEvents);
    const planReview = timeline.stages.find(s => s.id === 'plan_review')!;

    expect(planReview.events.length).toBeGreaterThanOrEqual(2);
    expect(planReview.status).toBe('denied');
    expect(timeline.closed).toBe(true);
  });

  it('surfaces an NVG denial as a failure on the nvg_wall stage', () => {
    const deniedEvents: RunEvent[] = [
      ev('run_opened', {}, '2026-05-09T00:03:00.000Z'),
      ev('plan_created', { planId: 'p3' }, '2026-05-09T00:03:01.000Z'),
      ev('plan_confirmed', { planId: 'p3' }, '2026-05-09T00:03:02.000Z'),
      ev('delegation_issued', {}, '2026-05-09T00:03:03.000Z'),
      ev('node_dispatched', {}, '2026-05-09T00:03:04.000Z'),
      ev(
        'node_failed',
        {
          governanceDenied: true,
          failureReason: 'nvg_oct_ceiling_denied: tier exceeds ceiling',
        },
        '2026-05-09T00:03:05.000Z'
      ),
      ev('run_closed', { closeReason: 'compile_skipped' }, '2026-05-09T00:03:06.000Z'),
    ];

    const timeline = computeRunTimeline(deniedEvents);

    expect(timeline.failure).not.toBeNull();
    expect(timeline.failure!.governanceDenied).toBe(true);
    expect(timeline.failure!.stageId).toBe('nvg_wall');
    const nvg = timeline.stages.find(s => s.id === 'nvg_wall')!;
    expect(nvg.status).toBe('denied');
  });

  it('returns an empty-but-valid timeline when no events have landed yet', () => {
    const timeline = computeRunTimeline([]);

    expect(timeline.closed).toBe(false);
    expect(timeline.failure).toBeNull();
    expect(timeline.runStartedAt).toBeNull();
    expect(timeline.finalResponseBody).toBeNull();
    // Every stage is present and pending so the renderer can show the
    // timeline shell while waiting for the first event.
    expect(timeline.stages.length).toBeGreaterThan(0);
    expect(timeline.stages.every(s => s.status === 'pending')).toBe(true);
  });

  // CLAUDE-CODE-MODEL-PREFERENCE-TRANSPARENCY §4 — surface preference
  // substitution in the timeline. When the user's chosen endpoint is
  // unhealthy and NVG silently runs a same-tier sibling, the run still
  // succeeds — but the operator must see what was actually used.
  it('surfaces preference substitution in nvg_wall and agent_response stages', () => {
    const substitutedEvents: RunEvent[] = [
      ev('run_opened', {}, '2026-05-09T00:05:00.000Z'),
      ev('plan_created', { planId: 'p5' }, '2026-05-09T00:05:01.000Z'),
      ev('plan_confirmed', { planId: 'p5' }, '2026-05-09T00:05:02.000Z'),
      ev('orchestrator_dispatched', {}, '2026-05-09T00:05:03.000Z'),
      ev('delegation_issued', {}, '2026-05-09T00:05:04.000Z'),
      ev('node_dispatched', { agentId: 'agent-1' }, '2026-05-09T00:05:05.000Z'),
      ev('partial_result', { mailboxItemId: 'mb1', responseSize: 500 }, '2026-05-09T00:05:06.000Z'),
      ev(
        'node_completed',
        {
          completionMetadata: {
            mailboxItemId: 'mb1',
            modelTierInvoked: 'on_prem_general',
            responseSize: 500,
            preferredEndpointId: 'ollama-jameshp',
            actualEndpointId: 'ollama-jamesImac',
            preferenceHonored: false,
            switchReason: 'preferred_unhealthy_same_tier_sibling',
          },
        },
        '2026-05-09T00:05:07.000Z'
      ),
      ev('dag_completed', { completedCount: 1 }, '2026-05-09T00:05:08.000Z'),
      ev('compile_assembly_complete', {}, '2026-05-09T00:05:09.000Z'),
      ev('final_response', { artifactId: 'art2' }, '2026-05-09T00:05:10.000Z'),
      ev('run_closed', { closeReason: 'completed' }, '2026-05-09T00:05:11.000Z'),
    ];

    const timeline = computeRunTimeline(substitutedEvents);

    // Run still succeeds — the substitution is informational, not failure.
    expect(timeline.closed).toBe(true);
    expect(timeline.failure).toBeNull();

    const nvg = timeline.stages.find(s => s.id === 'nvg_wall')!;
    expect(nvg.status).toBe('complete');
    // NVG wall surfaces the full preferred / actual / reason triple.
    expect(nvg.detailLines).toEqual(
      expect.arrayContaining([
        'Preferred: ollama-jameshp',
        'Actual: ollama-jamesImac',
        'Reason: preferred unhealthy same tier sibling',
      ])
    );

    const agentResponse = timeline.stages.find(s => s.id === 'agent_response')!;
    expect(agentResponse.status).toBe('complete');
    // Agent_response gets the shorter warning line — operators scanning the
    // timeline at a glance see the substitution without scrolling up.
    expect(agentResponse.detailLines).toEqual(
      expect.arrayContaining(['⚠ Model substituted: ollama-jamesImac'])
    );
  });

  it('omits substitution detail lines on the happy path (preference honored)', () => {
    const honoredEvents: RunEvent[] = [
      ...SUCCESS_EVENTS.slice(0, 8), // through node_completed
    ];
    // Replace node_completed with one carrying preferenceHonored=true.
    honoredEvents[8] = ev(
      'node_completed',
      {
        completionMetadata: {
          mailboxItemId: 'm1',
          modelTierInvoked: 'on_prem_general',
          responseSize: 200,
          preferredEndpointId: 'ollama-jameshp',
          actualEndpointId: 'ollama-jameshp',
          preferenceHonored: true,
          switchReason: null,
        },
      },
      '2026-05-09T00:00:08.000Z'
    );
    const fullEvents = [...honoredEvents, ...SUCCESS_EVENTS.slice(9)];

    const timeline = computeRunTimeline(fullEvents);
    const nvg = timeline.stages.find(s => s.id === 'nvg_wall')!;
    const agentResponse = timeline.stages.find(s => s.id === 'agent_response')!;

    // No substitution lines when preference honored — keeps the green path quiet.
    expect(nvg.detailLines.some(l => l.startsWith('Preferred:'))).toBe(false);
    expect(nvg.detailLines.some(l => l.startsWith('Actual:'))).toBe(false);
    expect(agentResponse.detailLines.some(l => l.includes('Model substituted'))).toBe(false);
  });

  it('omits substitution detail lines when no preference was supplied (Auto policy)', () => {
    const autoEvents: RunEvent[] = [...SUCCESS_EVENTS];
    autoEvents[8] = ev(
      'node_completed',
      {
        completionMetadata: {
          mailboxItemId: 'm1',
          modelTierInvoked: 'frontier_general',
          responseSize: 800,
          preferredEndpointId: null,
          actualEndpointId: 'openai-gpt',
          preferenceHonored: null, // null = "no preference asked", distinct from false
          switchReason: null,
        },
      },
      '2026-05-09T00:00:08.000Z'
    );

    const timeline = computeRunTimeline(autoEvents);
    const nvg = timeline.stages.find(s => s.id === 'nvg_wall')!;

    expect(nvg.detailLines.some(l => l.startsWith('Preferred:'))).toBe(false);
    expect(nvg.detailLines.some(l => l.startsWith('Actual:'))).toBe(false);
  });

  it('handles unknown event types without crashing', () => {
    const eventsWithUnknown: RunEvent[] = [
      ev('run_opened', {}, '2026-05-09T00:04:00.000Z'),
      ev('plan_created', { planId: 'p4' }, '2026-05-09T00:04:01.000Z'),
      ev('future_event_type_we_dont_know_about', { foo: 'bar' }, '2026-05-09T00:04:02.000Z'),
      ev('run_closed', { closeReason: 'completed' }, '2026-05-09T00:04:03.000Z'),
    ];

    expect(() => computeRunTimeline(eventsWithUnknown)).not.toThrow();
    const timeline = computeRunTimeline(eventsWithUnknown);
    expect(timeline.closed).toBe(true);
  });

  // ── Multi-node planner DAG state extraction ────────────────────────────

  describe('multi-node DAG extraction', () => {
    it('returns null dag before orchestrator_dispatched lands', () => {
      const timeline = computeRunTimeline([ev('run_opened', {})]);
      expect(timeline.dag).toBeNull();
    });

    it('returns null dag when orchestrator_dispatched lacks selectedAgents (older shape)', () => {
      // SUCCESS_EVENTS at the top of this file uses the pre-extension
      // shape — selectedAgentCount only, no selectedAgents[]. The
      // extractor returns null rather than fabricating a phantom DAG.
      const timeline = computeRunTimeline(SUCCESS_EVENTS);
      expect(timeline.dag).toBeNull();
    });

    it('extracts a 2-node DAG with edges + per-node status from a multi-node run', () => {
      const events: RunEvent[] = [
        ev('run_opened', {}, '2026-05-09T01:00:00.000Z'),
        ev(
          'plan_created',
          { planId: 'p-multi', nodeCount: 2, edgeCount: 1 },
          '2026-05-09T01:00:01.000Z'
        ),
        ev(
          'orchestrator_dispatched',
          {
            selectedAgentCount: 2,
            selectedAgents: [
              {
                taskId: 'node-A',
                agentId: 'agent-X',
                expectedOutputSlots: ['low_stock'],
                nodeType: 'nvg_dispatch',
                taskSummary: 'Scan inventory',
                planOrderIndex: 0,
                subTaskKey: 'scan',
                inputSlotReads: [],
              },
              {
                taskId: 'node-B',
                agentId: 'agent-X',
                expectedOutputSlots: ['adjustments'],
                nodeType: 'nvg_dispatch',
                taskSummary: 'Plan adjustments',
                planOrderIndex: 1,
                subTaskKey: 'adjust',
                inputSlotReads: [{ fromSubTaskKey: 'scan', slotId: 'low_stock' }],
              },
            ],
            edges: [
              {
                edgeId: 'edge-1',
                sourceNodeId: 'node-A',
                targetNodeId: 'node-B',
                edgeType: 'sequential',
                outputSlotRef: 'low_stock',
              },
            ],
          },
          '2026-05-09T01:00:02.000Z'
        ),
        ev('node_dispatched', { nodeId: 'node-A' }, '2026-05-09T01:00:03.000Z'),
        ev(
          'partial_result',
          { taskId: 'node-A', slotId: 'low_stock', mailboxItemId: 'm1' },
          '2026-05-09T01:00:04.000Z'
        ),
        ev(
          'node_completed',
          {
            nodeId: 'node-A',
            completionMetadata: { toolTurnCount: 1, toolCallsPerTurn: [1, 0], capReached: false },
          },
          '2026-05-09T01:00:05.000Z'
        ),
        ev('node_dispatched', { nodeId: 'node-B' }, '2026-05-09T01:00:06.000Z'),
      ];

      const timeline = computeRunTimeline(events);
      expect(timeline.dag).not.toBeNull();
      const dag = timeline.dag!;

      expect(dag.isMultiNode).toBe(true);
      expect(dag.nodes).toHaveLength(2);
      expect(dag.edges).toHaveLength(1);

      const scan = dag.nodes.find(n => n.subTaskKey === 'scan')!;
      expect(scan.taskSummary).toBe('Scan inventory');
      expect(scan.nodeType).toBe('nvg_dispatch');
      expect(scan.status).toBe('completed');
      expect(scan.toolTurnCount).toBe(1);
      expect(scan.toolCallsPerTurn).toEqual([1, 0]);
      expect(scan.capReached).toBe(false);
      expect(scan.writtenSlots).toEqual(['low_stock']);
      expect(scan.inputSlotReads).toEqual([]);

      const adjust = dag.nodes.find(n => n.subTaskKey === 'adjust')!;
      expect(adjust.status).toBe('dispatched');
      expect(adjust.inputSlotReads).toEqual([{ fromSubTaskKey: 'scan', slotId: 'low_stock' }]);

      const edge = dag.edges[0]!;
      expect(edge.sourceNodeId).toBe('node-A');
      expect(edge.targetNodeId).toBe('node-B');
      expect(edge.outputSlotRef).toBe('low_stock');
    });

    it('marks a failed node with governanceDenied + failureReason', () => {
      const events: RunEvent[] = [
        ev(
          'orchestrator_dispatched',
          {
            selectedAgents: [
              {
                taskId: 'node-X',
                agentId: 'agent-Y',
                expectedOutputSlots: ['out'],
                nodeType: 'secure_agent_handoff',
                taskSummary: 'secure step',
                planOrderIndex: 0,
                subTaskKey: 'secure_step',
                inputSlotReads: [],
              },
            ],
            edges: [],
          },
          '2026-05-09T02:00:00.000Z'
        ),
        ev('node_dispatched', { nodeId: 'node-X' }, '2026-05-09T02:00:01.000Z'),
        ev(
          'node_failed',
          {
            nodeId: 'node-X',
            failureReason: 'secure_handoff_oct_mismatch: downstream too low',
            governanceDenied: true,
          },
          '2026-05-09T02:00:02.000Z'
        ),
      ];

      const timeline = computeRunTimeline(events);
      const node = timeline.dag!.nodes[0]!;
      expect(node.status).toBe('failed');
      expect(node.governanceDenied).toBe(true);
      expect(node.failureReason).toMatch(/secure_handoff_oct_mismatch/);
    });

    it('treats a single sub-task with subTaskKey as multi-node (so the DAG view still renders)', () => {
      const events: RunEvent[] = [
        ev(
          'orchestrator_dispatched',
          {
            selectedAgents: [
              {
                taskId: 'solo',
                agentId: 'agent-Z',
                expectedOutputSlots: ['out'],
                nodeType: 'nxs_dispatch',
                taskSummary: 'one fixed action',
                planOrderIndex: 0,
                subTaskKey: 'solo',
                inputSlotReads: [],
              },
            ],
            edges: [],
          },
          '2026-05-09T03:00:00.000Z'
        ),
      ];
      const timeline = computeRunTimeline(events);
      expect(timeline.dag!.isMultiNode).toBe(true);
      expect(timeline.dag!.nodes[0]!.nodeType).toBe('nxs_dispatch');
    });

    it('legacy single-node run with no subTaskKey stays isMultiNode=false', () => {
      const events: RunEvent[] = [
        ev(
          'orchestrator_dispatched',
          {
            selectedAgents: [
              {
                taskId: 'legacy-1',
                agentId: 'agent-Q',
                expectedOutputSlots: ['default'],
                nodeType: 'nvg_dispatch',
                taskSummary: 'Task for agent agent-Q',
                planOrderIndex: 0,
                // No subTaskKey, no inputSlotReads — legacy shape.
              },
            ],
            edges: [],
          },
          '2026-05-09T04:00:00.000Z'
        ),
      ];
      const timeline = computeRunTimeline(events);
      expect(timeline.dag!.isMultiNode).toBe(false);
      expect(timeline.dag!.nodes[0]!.subTaskKey).toBeNull();
    });
  });
});

// ─── AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + Commit 8 ───
// `pendingPlannerCheckback` extraction from `plan_checkback_sent`
// events that carry `checkbackPayload` (planner-rejection shape).
// Distinct from the legacy NVG-tier checkback that only carries
// `{ planId }` in detail.

describe('computeRunTimeline — pendingPlannerCheckback extraction', () => {
  const PLANNER_CHECKBACK_PAYLOAD = {
    reason: 'no_capable_agent',
    reasonDetail: 'preflight_preferred_agents_insufficient: update:record:internal',
    missingCapabilities: ['update:record:internal'],
    rejectedSelectedAgentIds: ['00000000-0000-4000-8000-0000000000a2'],
    recommendedSelectedAgentIds: ['00000000-0000-4000-8000-0000000000a1'],
    alternativesByCapability: {
      'update:record:internal': [
        {
          agentId: '00000000-0000-4000-8000-0000000000a1',
          capability: 'update:record:internal',
          reason: 'warehouse-agent has update:record:internal',
        },
      ],
    },
  };

  it('extracts the planner-checkback payload when present in plan_checkback_sent.detail', () => {
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_rejected', { reason: 'no_capable_agent' }, '2026-05-13T00:00:01.000Z'),
      ev(
        'plan_checkback_sent',
        {
          reason: 'no_capable_agent',
          checkbackPayload: PLANNER_CHECKBACK_PAYLOAD,
        },
        '2026-05-13T00:00:02.000Z'
      ),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).not.toBeNull();
    expect(timeline.pendingPlannerCheckback?.reason).toBe('no_capable_agent');
    expect(timeline.pendingPlannerCheckback?.missingCapabilities).toEqual([
      'update:record:internal',
    ]);
    expect(timeline.pendingPlannerCheckback?.recommendedSelectedAgentIds).toEqual([
      '00000000-0000-4000-8000-0000000000a1',
    ]);
  });

  it('returns null when plan_checkback_sent lacks checkbackPayload (legacy NVG-tier shape)', () => {
    // Legacy NVG-tier checkback events only carry `{ planId }` in
    // detail. The extractor MUST NOT mistake these for planner-level
    // checkbacks (they go through the `pendingCheckback` path instead).
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_created', { planId: 'p1' }, '2026-05-13T00:00:01.000Z'),
      ev('plan_checkback_sent', { planId: 'p1' }, '2026-05-13T00:00:02.000Z'),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).toBeNull();
  });

  it('clears the pending planner checkback when plan_created arrives after', () => {
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_rejected', { reason: 'no_capable_agent' }, '2026-05-13T00:00:01.000Z'),
      ev(
        'plan_checkback_sent',
        { reason: 'no_capable_agent', checkbackPayload: PLANNER_CHECKBACK_PAYLOAD },
        '2026-05-13T00:00:02.000Z'
      ),
      // Operator accepts suggestions → new run opens → plan_created
      // on the new run flows back into the SAME events array via the
      // workspace shell. The extractor clears the pending state.
      ev('plan_created', { planId: 'p2' }, '2026-05-13T00:00:03.000Z'),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).toBeNull();
  });

  it('clears when run_closed arrives after the checkback', () => {
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_rejected', { reason: 'no_capable_agent' }, '2026-05-13T00:00:01.000Z'),
      ev(
        'plan_checkback_sent',
        { reason: 'no_capable_agent', checkbackPayload: PLANNER_CHECKBACK_PAYLOAD },
        '2026-05-13T00:00:02.000Z'
      ),
      ev('run_closed', { closeReason: 'user_cancelled' }, '2026-05-13T00:00:03.000Z'),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).toBeNull();
  });

  it('clears when run_cancelled arrives after the checkback (Cancel-Run path)', () => {
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_rejected', { reason: 'no_capable_agent' }, '2026-05-13T00:00:01.000Z'),
      ev(
        'plan_checkback_sent',
        { reason: 'no_capable_agent', checkbackPayload: PLANNER_CHECKBACK_PAYLOAD },
        '2026-05-13T00:00:02.000Z'
      ),
      ev('run_cancelled', { reason: 'user_cancelled_after_checkback' }, '2026-05-13T00:00:03.000Z'),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).toBeNull();
  });

  it('returns null when no plan_checkback_sent has ever fired', () => {
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_created', { planId: 'p1' }, '2026-05-13T00:00:01.000Z'),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).toBeNull();
  });

  // AMEND-nexus-planner-chat-tier-v0-2-0.md §3.10 — chat-tier rejections
  // surface the same RejectionCheckbackPayload shape Branch 3 uses. The
  // reducer is payload-shape-agnostic; this test pins that behavior so a
  // future change can't accidentally specialize the chat path.
  it('extracts chat-tier checkback (synthesize:content missing) the same way as Branch 3', () => {
    const CHAT_CHECKBACK_PAYLOAD = {
      reason: 'no_capable_agent',
      reasonDetail:
        'chat tier requires agent with synthesize capability; agent <id> capabilities: [read:record:single]',
      missingCapabilities: ['synthesize:content'],
      rejectedSelectedAgentIds: ['00000000-0000-4000-a000-000000000031'],
      recommendedSelectedAgentIds: ['00000000-0000-4000-a000-000000000004'],
      alternativesByCapability: {
        'synthesize:content': [
          {
            agentId: '00000000-0000-4000-a000-000000000004',
            capability: 'synthesize:content',
            reason: 'agent 00000000-0000-4000-a000-000000000004 has synthesize in capabilities',
          },
        ],
      },
    };
    const events: RunEvent[] = [
      ev('run_opened', { promptDigest: 'abc' }, '2026-05-13T00:00:00.000Z'),
      ev('plan_rejected', { reason: 'no_capable_agent' }, '2026-05-13T00:00:01.000Z'),
      ev(
        'plan_checkback_sent',
        { reason: 'no_capable_agent', checkbackPayload: CHAT_CHECKBACK_PAYLOAD },
        '2026-05-13T00:00:02.000Z'
      ),
    ];
    const timeline = computeRunTimeline(events);
    expect(timeline.pendingPlannerCheckback).not.toBeNull();
    expect(timeline.pendingPlannerCheckback?.missingCapabilities).toEqual(['synthesize:content']);
    expect(timeline.pendingPlannerCheckback?.recommendedSelectedAgentIds).toEqual([
      '00000000-0000-4000-a000-000000000004',
    ]);
  });
});
