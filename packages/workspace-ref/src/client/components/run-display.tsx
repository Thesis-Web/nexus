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
import { RunDagSection } from './run-dag-section.js';
import { RunDenialCard } from './run-denial-card.js';
import { RunCheckbackCard } from './run-checkback-card.js';
import { PlanCheckbackModal } from './plan-checkback-modal.js';
import { PlannerSuggestionCard } from './planner-suggestion-card.js';
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

  // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + Commit 8 — local
  // dismissal flag for the planner-rejection checkback modal. Flips
  // true when the operator clicks Accept (the new run takes over via
  // its own event stream) or Cancel (the close API records the
  // intent). The reducer's `pendingPlannerCheckback` also clears on
  // `plan_created` / `run_closed` / `run_cancelled`, so this state
  // is belt-and-suspenders for the brief window before the SSE
  // delivers the terminal event.
  const [plannerCheckbackDismissed, setPlannerCheckbackDismissed] = useState(false);

  // Recompute the play-by-play whenever a new event lands. The reducer is a
  // pure function — memoising on the array reference keeps it cheap during
  // SSE bursts (each new event is one append → identity changes once).
  const timeline = useMemo(() => computeRunTimeline(events), [events]);

  // Extract the originating run's prompt + preferredEndpointId from the
  // `run_opened` event so the PlanCheckbackModal can pass them to the
  // re-issued `createRun(...)` call. Without these the Zod
  // FreeTextSchema would reject (prompt.min(1) violated).
  const runOpened = useMemo(() => events.find(e => e.type === 'run_opened'), [events]);
  const checkbackPrompt = useMemo(() => {
    const detail = runOpened?.detail;
    if (!detail || typeof detail !== 'object') return '';
    const p = (detail as Record<string, unknown>)['prompt'];
    return typeof p === 'string' ? p : '';
  }, [runOpened]);
  const checkbackPreferredEndpointId = useMemo(() => {
    const detail = runOpened?.detail;
    if (!detail || typeof detail !== 'object') return null;
    const v = (detail as Record<string, unknown>)['preferredEndpointId'];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }, [runOpened]);

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
  // planner_infeasible, but the synchronous path can land first on a fast
  // reject. computeRunTimeline already lifts planner_infeasible events into
  // a denial; this path covers the local, pre-SSE rejection. (HL#4 canonical
  // — legacy `plan_rejected` alias removed 2026-05-23.)
  const synchronousRejectFailure: RunTimelineState['failure'] =
    planRejection != null && timeline.failure === null
      ? {
          stageId: 'planning',
          code: planRejection.reason || 'planner_infeasible',
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

        {/* AMEND-spec-nexus-orch §5 — multi-node DAG visualization.
            Renders only when the run's plan carried multiple nodes
            (or any sub-task carried a subTaskKey). Single-prompt
            runs continue to use the single-stage timeline above. */}
        {timeline.dag !== null && timeline.dag.isMultiNode && (
          <RunDagSection dag={timeline.dag} runStartedAt={timeline.runStartedAt} />
        )}

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

        {/* AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + Commit 8 —
            planner-level preflight rejection counter-suggestion modal.
            Renders when the preferred-agents preflight branch (Branch 3)
            rejected with usable alternatives. Distinct from the NVG-tier
            checkback above (different mechanism, different payload).
            Suppressed once the operator has dismissed via Accept or
            Cancel — the local dismissal flag covers the brief window
            before the SSE delivers the terminal event that clears the
            reducer's `pendingPlannerCheckback` field. */}
        {timeline.pendingPlannerCheckback && runId && !plannerCheckbackDismissed && (
          <PlanCheckbackModal
            sourceRunId={runId}
            payload={timeline.pendingPlannerCheckback}
            prompt={checkbackPrompt}
            preferredEndpointId={checkbackPreferredEndpointId}
            onDismiss={() => setPlannerCheckbackDismissed(true)}
            onAccepted={(_newRunId: string) => {
              // The re-issued run has its own runId + its own event
              // stream. Workspace shell observes the new run via SSE
              // independently; for the originating-run view we just
              // dismiss the modal (the new run's runId is logged in
              // the source run's run_cancelled detail for audit
              // correlation).
              setPlannerCheckbackDismissed(true);
            }}
          />
        )}

        {/* HL#4 + fix-spec 2026-05-23 §4 / DRIFT-LOG D-02 — planner suggestion
            card. Renders when the failure landed at the planning stage from
            a planner_infeasible event WITHOUT an attached checkback payload
            (Paths B / C in the run-coordinator HL#4 contract block). Orch
            has zero governance authority — this card SUGGESTS the run won't
            reach final response and offers a single Cancel-Run affordance
            (owner ratification 2026-05-23 second round: Edit Prompt pulled
            as a prompt-rewrite bypass surface; user-retry goes back through
            the primary PromptPanel which carries the full orch preflight).
            "Run It Anyway" / bypass orch is logged at DRIFT-LOG D-03 pending
            contract + RBAC + audit-event design. PlanCheckbackModal above
            handles the Path A case (planner attached executable alternatives).
            RunDenialCard below handles real governance denials (NVG / Gate
            04/05 / etc.) where the framing genuinely IS "request denied".
            Mutually exclusive — gated by stageId + pendingPlannerCheckback. */}
        {failure && failure.stageId === 'planning' && !timeline.pendingPlannerCheckback && runId ? (
          <PlannerSuggestionCard
            sourceRunId={runId}
            reason={failure.code}
            reasonDetail={failure.message ?? ''}
            onResolved={() => {
              // The originating run is now closed (or being closed); the
              // SSE-driven timeline will pick up the terminal event and
              // remove this card on the next reducer pass. No local
              // dismissal flag needed — the failure-stage match itself
              // unmounts the card once `failure` clears.
            }}
          />
        ) : (
          /* Denial card — shown when the timeline detected a failure stage
             that is NOT a planner suggestion case (i.e., governance denial
             at NVG / Approval gates / etc., or any non-planning stage). */
          failure && <RunDenialCard failure={failure} />
        )}

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
