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
// Affordances — owner ratification 2026-05-23 second round:
//   - Cancel Run — closeRun(sourceRunId, 'user_cancelled_after_checkback').
//     The only safe affordance. The "checkback" naming on the existing
//     closeReason is loose for the no-payload case (the planner_infeasible
//     event IS the implicit suggestion that the user is responding to) but
//     reuses the validated reason set in routes/workspace.ts §POST
//     /workspace/runs/:runId/close.
//
// EXPLICITLY NOT present:
//   - Edit Prompt and Retry — initially drafted; owner pulled it because
//     it's a prompt-rewrite bypass surface ("high-tech user might edit
//     the prompt and try to bypass orch"). A user wanting to retry with
//     a reframed prompt MUST go back through the primary PromptPanel,
//     which carries the full orch preflight + intent classification.
//     Cancel-then-retype is the only safe pattern.
//   - Run It Anyway / bypass orch — open architectural decision (see
//     DRIFT-LOG D-03). Requires a new contract field on WorkspaceRunRequest,
//     RBAC on who can bypass orch, audit event for the override, and a
//     decision on what "run it anyway" actually means for malformed-plan
//     vs no-capable-agent paths. Out of scope until that's settled; the
//     deterministic-orch worst case is "annoying but safe", the LLM-orch
//     worst case (orch wrong often) is the real driver.

import { useState } from 'react';
import { closeRun } from '../api.js';

export interface PlannerSuggestionCardProps {
  /** The originating run that produced the planner_infeasible event. */
  sourceRunId: string;
  /** Canonical reason code from the planner_infeasible event detail (e.g.
   *  `no_capable_agent`, `unmappable_request`, `malformed_request`). */
  reason: string;
  /** Free-prose detail from the planner_infeasible event detail. */
  reasonDetail: string;
  /** Called after the originating run is closed. The parent re-renders
   *  without the card. Passes null because no new runId is created. */
  onResolved: (newRunId: null) => void;
}

// Return type intentionally inferred — the package's tsconfig uses
// `"jsx": "react-jsx"` (React 17+ automatic runtime) which does NOT
// expose a global `JSX` namespace. Other components in this package
// (PlanCheckbackModal, Sidebar, Login, RunDisplay, PromptPanel) all
// rely on inference. Adding `: JSX.Element` here was a 2026-05-23 drift
// caught by the pre-push ci:gate audit; canonical pattern is to infer.
export function PlannerSuggestionCard({
  sourceRunId,
  reason,
  reasonDetail,
  onResolved,
}: PlannerSuggestionCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (): Promise<void> => {
    setSubmitting(true);
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

      <div className="nx-planner-suggestion-actions">
        <button
          type="button"
          className="nx-btn nx-btn--deny"
          disabled={submitting}
          onClick={() => void cancel()}
        >
          {submitting ? 'Cancelling…' : 'Cancel Run'}
        </button>
      </div>
      <div className="nx-planner-suggestion-footnote">
        To retry, cancel this run and submit a new prompt from the prompt panel.
      </div>

      {error && (
        <div className="nx-planner-suggestion-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
