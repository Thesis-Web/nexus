// packages/workspace-ref/src/client/components/planner-suggestion-card.tsx
//
// HL#4 / fix-spec post-consolidation 2026-05-23 §4 + DRIFT-LOG D-02.
//
// Renders when the planner returns infeasibility WITHOUT a
// RejectionCheckbackPayload — the two paths the existing PlanCheckbackModal
// can't drive because there are no alternative agents to render:
//
//   Path B — planner returns PlanRejection with no executable suggestions
//            (e.g. `unmappable_request`, `no_capable_agent` against an empty
//            agent set, `capability_outside_ceiling`).
//   Path C — plan validation failed as `malformed_request` (no plan exists
//            to surface for review or to "run anyway").
//
// Owner reframing 2026-05-23: orch has zero governance authority — it
// SUGGESTS a run won't reach final response, it never DECIDES the run
// failed. Copy therefore says "Orch suggests this run won't reach final
// response because <reason>", not "Plan failed". The only terminal close
// path is the user's explicit POST /workspace/runs/:runId/close.
//
// Affordances:
//   - Cancel Run — closeRun(sourceRunId, 'user_cancelled_after_checkback').
//     The "checkback" naming on the existing closeReason is loose for the
//     no-payload case (the planner_infeasible event IS the implicit
//     suggestion that the user is responding to) but reuses the validated
//     reason set in routes/workspace.ts §POST /workspace/runs/:runId/close.
//   - Edit Prompt and Retry — inline textarea pre-populated with the
//     originating prompt; submit closes the original run with the same
//     cancel reason and issues a fresh createRun(...) carrying
//     `checkbackSourceRunId` for audit correlation.
//
// "Run it anyway" is intentionally absent: for Paths B/C there is no plan
// to execute. A bypass-feasibility-check affordance would require a new
// contract field on WorkspaceRunRequest and a threat model — out of scope
// for this card. (Path A — planner attached a checkback with alternatives
// — keeps using PlanCheckbackModal, which already covers all three of
// Accept-Suggestion / Cancel-Run / re-issue semantics.)
//
// Layer rule: this component lives in workspace-ref/client and uses the
// hardcoded `/workspace/...` HTTP endpoints via api.ts, same as every other
// workspace↔server call today. When the Manifest Manifold arc lands
// (memory project_manifest_manifold_arc) this endpoint plus 11 others
// migrate to manifest-registered seams together.

import { useState } from 'react';
import { closeRun, createRun } from '../api.js';

export interface PlannerSuggestionCardProps {
  /** The originating run that produced the planner_infeasible event. Carried
   *  forward as `checkbackSourceRunId` on any retry so audit can correlate
   *  the rejected suggestion to the user's response. */
  sourceRunId: string;
  /** Canonical reason code from the planner_infeasible event detail (e.g.
   *  `no_capable_agent`, `unmappable_request`, `malformed_request`). */
  reason: string;
  /** Free-prose detail from the planner_infeasible event detail. */
  reasonDetail: string;
  /** Originating prompt — pre-populated into the Edit Prompt textarea so the
   *  user doesn't have to retype. Lifted from the `run_opened` event detail
   *  by the parent (run-display.tsx already does this for PlanCheckbackModal). */
  prompt: string;
  /** Optional model preference echo — re-applied when the user submits an
   *  edited prompt so the new run carries the same endpoint hint. */
  preferredEndpointId: string | null;
  /** Called after the originating run is closed (either via Cancel Run or
   *  via Edit-Prompt re-issue). The parent re-renders without the card. */
  onResolved: (newRunId: string | null) => void;
}

type SubmitState = null | 'cancel' | 'retry';
type Mode = 'view' | 'edit';

export function PlannerSuggestionCard({
  sourceRunId,
  reason,
  reasonDetail,
  prompt,
  preferredEndpointId,
  onResolved,
}: PlannerSuggestionCardProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<string>(prompt);
  const [submitting, setSubmitting] = useState<SubmitState>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (): Promise<void> => {
    setSubmitting('cancel');
    setError(null);
    try {
      const res = await closeRun(sourceRunId, 'user_cancelled_after_checkback');
      if (!res.ok) {
        // Defense in depth — surface the error but still resolve so the
        // operator isn't trapped. The ledger captured the close attempt.
        setError(res.error ?? 'Run close failed; dismissing card regardless');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error during cancel');
    }
    onResolved(null);
  };

  const submitRetry = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError('Prompt cannot be empty');
      return;
    }
    setSubmitting('retry');
    setError(null);
    try {
      // Close the source run first — fail-closed: do NOT re-issue if the
      // close failed, otherwise audit would show two open runs with
      // checkbackSourceRunId pointing at a non-closed source. Same
      // discipline PlanCheckbackModal uses for Accept-Suggestions.
      const closeRes = await closeRun(sourceRunId, 'user_cancelled_after_checkback');
      if (!closeRes.ok) {
        setError(closeRes.error ?? 'Failed to close originating run before retry');
        setSubmitting(null);
        return;
      }
      const body: Record<string, unknown> = {
        promptMode: 'free_text',
        prompt: trimmed,
        checkbackSourceRunId: sourceRunId,
      };
      if (preferredEndpointId) body['preferredEndpointId'] = preferredEndpointId;
      const res = await createRun(body);
      if (!res.ok || !res.data?.runId) {
        setError(res.error ?? 'Failed to issue retry run');
        setSubmitting(null);
        return;
      }
      onResolved(res.data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error during retry');
      setSubmitting(null);
    }
  };

  const busy = submitting !== null;

  return (
    <div className="nx-planner-suggestion-card" role="region" aria-label="Orch suggestion">
      <div className="nx-planner-suggestion-header">
        <span className="nx-badge nx-badge--suggestion">Orch suggests</span>
        <span className="nx-planner-suggestion-where">at Planning</span>
      </div>
      <div className="nx-planner-suggestion-summary">
        Orch suggests this run won&apos;t reach final response.
      </div>
      <div className="nx-planner-suggestion-reason">{reason || 'planner_infeasible'}</div>
      {reasonDetail && <div className="nx-planner-suggestion-detail">{reasonDetail}</div>}

      {mode === 'view' ? (
        <div className="nx-planner-suggestion-actions">
          <button
            type="button"
            className="nx-btn nx-btn--secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMode('edit');
            }}
          >
            Edit Prompt and Retry
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--deny"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {submitting === 'cancel' ? 'Cancelling…' : 'Cancel Run'}
          </button>
        </div>
      ) : (
        <div className="nx-planner-suggestion-edit">
          <label htmlFor="nx-planner-suggestion-draft" className="nx-planner-suggestion-label">
            Reframe your prompt:
          </label>
          <textarea
            id="nx-planner-suggestion-draft"
            className="nx-planner-suggestion-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={busy}
            rows={4}
          />
          <div className="nx-planner-suggestion-actions">
            <button
              type="button"
              className="nx-btn"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void submitRetry()}
            >
              {submitting === 'retry' ? 'Submitting…' : 'Submit New Run'}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setMode('view');
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="nx-planner-suggestion-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
