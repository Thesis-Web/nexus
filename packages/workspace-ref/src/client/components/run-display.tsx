// packages/workspace-ref/src/client/components/run-display.tsx
// Blueprint §3.5 (response surface), §3.5.1-3.5.5.
// Approval cards, run timeline (play-by-play), denial card,
// FinalResponseArtifact display.
//
// The single-line status banner has been replaced by a vertical RunTimeline
// driven off the SSE event stream (see run-stage-reducer.ts). The Governed
// Response card and Approval cards keep their existing behavior — they're
// rendered below the timeline when the underlying events arrive.

import { useState, useMemo } from 'react';
import { submitApproval } from '../api.js';
import type { RunEvent } from '../hooks/use-run-events.js';
import { RunTimeline } from './run-timeline.js';
import { RunDenialCard } from './run-denial-card.js';
import { RunCheckbackCard } from './run-checkback-card.js';
import { computeRunTimeline, type RunTimelineState } from './run-stage-reducer.js';

interface RunDisplayProps {
  runId: string | null;
  events: RunEvent[];
  status: { status: string; eventTypes: string[] } | null;
  planRejection?: { reason: string; reasonDetail: string } | null;
}

interface ApprovalPrompt {
  approvalId: string;
  gate: string;
  description: string;
  runId: string;
}

export function RunDisplay({ runId, events, status, planRejection }: RunDisplayProps) {
  const [approvalStates, setApprovalStates] = useState<
    Record<string, 'pending' | 'approved' | 'denied'>
  >({});

  // Recompute the play-by-play whenever a new event lands. The reducer is a
  // pure function — memoising on the array reference keeps it cheap during
  // SSE bursts (each new event is one append → identity changes once).
  const timeline = useMemo(() => computeRunTimeline(events), [events]);

  if (!runId) {
    return (
      <div className="nx-empty">
        <div className="nx-empty-icon">◇</div>
        <div>Submit a prompt to start a governed run</div>
        <div style={{ fontSize: '12px' }}>
          Every request gets a run ID linked across all three audit streams
        </div>
      </div>
    );
  }

  // Approval prompts ride the same SSE stream — they're not part of the
  // run-ledger play-by-play (different surface, same source).
  const approvalPrompts: ApprovalPrompt[] = [];
  for (const event of events) {
    if (event.type === 'approval_prompt' && event.detail) {
      approvalPrompts.push({
        approvalId: (event.detail['approvalId'] as string) ?? '',
        gate: (event.detail['gate'] as string) ?? 'Gate 05',
        description: (event.detail['description'] as string) ?? '',
        runId: event.runId,
      });
    }
  }

  // Plan rejection from the synchronous POST /workspace/runs response is
  // surfaced here as a synthesised denial — the SSE stream also delivers
  // plan_rejected, but the synchronous path can land first on a fast reject.
  // computeRunTimeline already lifts plan_rejected events into a denial; this
  // path covers the local, pre-SSE rejection.
  const synchronousRejectFailure: RunTimelineState['failure'] =
    planRejection != null && timeline.failure === null
      ? {
          stageId: 'planning',
          code: planRejection.reason || 'plan_rejected',
          message: planRejection.reasonDetail || '',
          governanceDenied: true,
        }
      : null;

  const failure = timeline.failure ?? synchronousRejectFailure;
  const finalResponse = timeline.finalResponseBody;

  const handleApproval = async (approvalId: string, decision: 'approved' | 'denied') => {
    setApprovalStates(s => ({ ...s, [approvalId]: decision }));
    try {
      await submitApproval(runId, approvalId, decision);
    } catch {
      setApprovalStates(s => ({ ...s, [approvalId]: 'pending' }));
    }
  };

  return (
    // `flex: 1; minHeight: 0` (NOT `height: 100%`) so the wrapper shrinks
    // correctly inside `.nx-main` (a flex column with `overflow: hidden`).
    // With `height: 100%` the wrapper pushed the prompt panel below the
    // overflow-hidden boundary once the timeline grew, so after run_closed
    // the input vanished. `minHeight: 0` is required because flex items
    // default to `min-height: auto` and would otherwise refuse to shrink
    // below their content size, defeating `.nx-content`'s overflow-y: auto.
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="nx-content">
        <RunTimeline timeline={timeline} />

        {/* Empty state for an active run before the first SSE event lands. */}
        {events.length === 0 && status?.status === 'open' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--nx-text-muted)' }}>
            Awaiting agent dispatch…
          </div>
        )}

        {/* Approval cards */}
        {approvalPrompts.map(ap => {
          const state = approvalStates[ap.approvalId] ?? 'pending';
          return (
            <div key={ap.approvalId} className="nx-approval-card">
              <div className="nx-approval-header">Approval required — {ap.gate}</div>
              <div className="nx-approval-body">{ap.description}</div>
              {state === 'pending' ? (
                <div className="nx-approval-actions">
                  <button
                    className="nx-btn nx-btn--approve"
                    onClick={() => void handleApproval(ap.approvalId, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    className="nx-btn nx-btn--deny"
                    onClick={() => void handleApproval(ap.approvalId, 'denied')}
                  >
                    Deny
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: state === 'approved' ? 'var(--nx-green)' : 'var(--nx-red)',
                  }}
                >
                  {state === 'approved' ? '✓ Approved' : '✗ Denied'}
                </div>
              )}
            </div>
          );
        })}

        {/* CHECKBACK-spec — pending checkback. Renders while the
            orchestrator is awaiting the user's allow/deny decision. */}
        {timeline.pendingCheckback && (
          <RunCheckbackCard runId={runId} checkback={timeline.pendingCheckback} />
        )}

        {/* Denial card — shown when the timeline detected a failure stage.
            Suppresses the Governed Response card below. */}
        {failure && <RunDenialCard failure={failure} />}

        {/* Final response — FinalResponseArtifact display [GWS4-AUD-02].
            Only render on success runs; denial paths show the denial card
            instead (spec §"Denial Rendering"). */}
        {finalResponse && !failure && (
          <div className="nx-agent-card" style={{ borderColor: 'var(--nx-green-border)' }}>
            <div className="nx-agent-card-header">
              <span className="nx-badge nx-badge--governed">Governed Response</span>
              <span
                style={{ marginLeft: 'auto', fontFamily: 'var(--nx-font-mono)', fontSize: '11px' }}
              >
                {runId.slice(0, 8)}…
              </span>
            </div>
            <div className="nx-agent-card-body">{finalResponse}</div>
          </div>
        )}
      </div>
    </div>
  );
}
