// packages/workspace-ref/src/client/components/run-timeline.tsx
//
// Vertical timeline that renders the play-by-play of a governed run.
// Pure presentation: takes a RunTimelineState (computed from the SSE event
// stream by run-stage-reducer.ts) and draws stages with status icons,
// offsets, and detail lines.
//
// SPEC: CLAUDE-CODE-PLAY-BY-PLAY-SPEC.md §"WHAT THE PLAY-BY-PLAY SHOULD LOOK LIKE",
// §"In-Progress Animation".
//
// Style hooks live in styles.css (see `/* ── Run Timeline ── */`). This
// component never inlines colors — all visual states reference CSS variables
// already declared in :root so dark/light parity stays intact.

import { useEffect, useState } from 'react';
import type { RunStage, RunTimelineState, StageStatus } from './run-stage-reducer.js';
import { formatElapsed, formatStageOffset } from './run-stage-reducer.js';

interface RunTimelineProps {
  timeline: RunTimelineState;
}

const STATUS_GLYPH: Record<StageStatus, string> = {
  pending: '○',
  active: '◎',
  complete: '✓',
  denied: '✗',
  error: '✗',
  skipped: '–',
};

export function RunTimeline({ timeline }: RunTimelineProps) {
  // While any stage is active we tick `now` so the elapsed counter advances.
  // Cheap (no event subscriptions) and stops as soon as nothing is active.
  const hasActive = timeline.stages.some(s => s.status === 'active');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasActive) return;
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [hasActive]);

  // CLAUDE-CODE-FIX-SSE-AND-PLAN-REVIEW BUG-2: hide opt-in stages that
  // never fired. plan_review only exists when the orchestrator triggered
  // a checkback (plan_checkback_required / plan_checkback_resolved). On
  // auto-approval (healthy primary tier, no preference conflict) it has
  // zero events and the reducer marks it 'skipped' — which renders as a
  // grayed-out dashed row and looks like something went wrong. When the
  // checkback truly fired the stage carries events and renders normally.
  const visibleStages = timeline.stages.filter(stage => {
    if (stage.id === 'plan_review' && stage.events.length === 0) return false;
    return true;
  });

  return (
    <div className="nx-timeline" role="list" aria-label="Run play-by-play">
      {visibleStages.map((stage, idx) => (
        <RunStageRow
          key={stage.id}
          stage={stage}
          isLast={idx === visibleStages.length - 1}
          runStartedAt={timeline.runStartedAt}
          now={now}
        />
      ))}
    </div>
  );
}

interface RunStageRowProps {
  stage: RunStage;
  isLast: boolean;
  runStartedAt: string | null;
  now: number;
}

function RunStageRow({ stage, isLast, runStartedAt, now }: RunStageRowProps) {
  const statusClass = `nx-timeline-stage--${stage.status}`;
  const offset = formatStageOffset(stage.startedAt ?? stage.completedAt ?? null, runStartedAt);
  const showElapsed = stage.status === 'active' && stage.startedAt !== null;
  const elapsed = showElapsed ? formatElapsed(stage.startedAt, now) : '';

  return (
    <div className={`nx-timeline-stage ${statusClass}`} role="listitem">
      <div className="nx-timeline-rail" aria-hidden="true">
        <div className="nx-timeline-glyph">{STATUS_GLYPH[stage.status]}</div>
        {!isLast && <div className="nx-timeline-connector" />}
      </div>

      <div className="nx-timeline-body">
        <div className="nx-timeline-header">
          <span className="nx-timeline-label">{stage.label}</span>
          {offset && <span className="nx-timeline-offset">{offset}</span>}
        </div>

        {stage.detailLines.length > 0 && (
          <ul className="nx-timeline-detail">
            {stage.detailLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}

        {showElapsed && <div className="nx-timeline-elapsed">{elapsed}</div>}

        {(stage.status === 'denied' || stage.status === 'error') && stage.failureCode && (
          <div className="nx-timeline-failure">
            <span className="nx-timeline-failure-code">{stage.failureCode}</span>
            {stage.failureMessage && <span> — {stage.failureMessage}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
