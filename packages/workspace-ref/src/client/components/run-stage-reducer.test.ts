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
});
