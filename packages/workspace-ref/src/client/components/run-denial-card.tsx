// packages/workspace-ref/src/client/components/run-denial-card.tsx
//
// Displays the human-facing denial card when a run failed at any governance
// checkpoint. Companion to RunTimeline — the timeline shows where the denial
// happened, this card explains what it means and reassures the user that
// nothing leaked through Nexus.
//
// SPEC: CLAUDE-CODE-PLAY-BY-PLAY-SPEC.md §"Denial Rendering".

import type { RunTimelineState, StageId } from './run-stage-reducer.js';

interface RunDenialCardProps {
  failure: NonNullable<RunTimelineState['failure']>;
}

const STAGE_LABELS: Record<StageId, string> = {
  prompt_received: 'Prompt intake',
  planning: 'Planning',
  delegation: 'Delegation',
  nvg_wall: 'NVG Wall',
  agent_response: 'Agent response',
  compile: 'Compile',
  final_response: 'Final response',
  run_closed: 'Run closure',
};

export function RunDenialCard({ failure }: RunDenialCardProps) {
  const where = STAGE_LABELS[failure.stageId];
  return (
    <div className="nx-denial-card" role="alert">
      <div className="nx-denial-header">
        <span className="nx-badge nx-badge--denied">Request Denied</span>
        <span className="nx-denial-where">at {where}</span>
      </div>
      <div className="nx-denial-code">{failure.code}</div>
      {failure.message && <div className="nx-denial-message">{failure.message}</div>}
      <div className="nx-denial-footnote">
        {failure.governanceDenied
          ? 'This request was blocked by Nexus governance. No data was sent to or received from any model.'
          : 'This request stopped before completion. Inspect the timeline for the failing stage.'}
      </div>
    </div>
  );
}
