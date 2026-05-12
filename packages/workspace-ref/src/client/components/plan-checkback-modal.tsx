// packages/workspace-ref/src/client/components/plan-checkback-modal.tsx
//
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + §5.3 — the
// planner-rejection counter-suggestion modal. Renders when the
// preferred-agents preflight branch (Branch 3) rejects with usable
// alternatives. The operator picks Accept-Suggestions (re-issue a new
// run with the lexicon's recommended agents + `checkbackSourceRunId`)
// or Cancel-Run (dismiss; the original run already wrote a
// `plan_rejected` ledger event, so it's terminal).
//
// V1 scope per §0.5:
//   - 2-way Accept / Cancel only.
//   - 3-way "Try anyway" deferred to V2 (requires new
//     `bypassFeasibilityCheck` contract field + threat modeling).
//
// Wired by `run-display.tsx`: reads `derivedState.pendingPlannerCheckback`
// from the run-stage reducer (extracted from the
// `plan_checkback_sent` ledger event's `detail.checkbackPayload` field).
// When the field is non-null the modal mounts; when the operator
// dismisses or accepts it unmounts.

import { useState } from 'react';
import type { PlannerCheckbackPayload } from './run-stage-reducer.js';
import { closeRun, createRun } from '../api.js';

interface PlanCheckbackModalProps {
  /** The original run that produced this counter-suggestion. Carried
   *  forward as `checkbackSourceRunId` on the re-issued run for audit. */
  sourceRunId: string;
  /** The planner-level checkback payload. */
  payload: PlannerCheckbackPayload;
  /** Prompt to re-issue (lifted from the originating run state). The
   *  modal can't compute this — caller passes it through. */
  prompt: string;
  /** Optional model preference echo. */
  preferredEndpointId: string | null;
  /** Called when the user dismisses the modal — Cancel Run path OR
   *  after a successful Accept Suggestions submit. Parent re-renders
   *  without the modal. */
  onDismiss: () => void;
  /** Called with the new runId after Accept Suggestions succeeds, so
   *  the parent can navigate to the new run. */
  onAccepted: (newRunId: string) => void;
}

export function PlanCheckbackModal({
  sourceRunId,
  payload,
  prompt,
  preferredEndpointId,
  onDismiss,
  onAccepted,
}: PlanCheckbackModalProps) {
  const [submitting, setSubmitting] = useState<'accept' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptSuggestions = async (): Promise<void> => {
    setSubmitting('accept');
    setError(null);
    try {
      // §3.7 Accept-Suggestions: close the source run first, then open
      // the re-issued run. Fail-closed on close failure — do NOT
      // re-issue if the source run can't be closed, because the audit
      // trail would otherwise show two open runs with checkbackSourceRunId
      // pointing at a non-closed source.
      const closeRes = await closeRun(sourceRunId, 'user_accepted_checkback_reissued');
      if (!closeRes.ok) {
        setError(closeRes.error ?? 'Failed to close source run before re-issuing');
        setSubmitting(null);
        return;
      }

      // Build the re-issued WorkspaceRunRequest. selectedAgentIds is
      // replaced by the executable recommendedSelectedAgentIds; the
      // checkbackSourceRunId field correlates this new run back to the
      // rejected one for audit per §3.7.
      const body: Record<string, unknown> = {
        promptMode: 'free_text',
        prompt,
        agents: payload.recommendedSelectedAgentIds,
        checkbackSourceRunId: sourceRunId,
      };
      if (preferredEndpointId) {
        body['preferredEndpointId'] = preferredEndpointId;
      }
      const res = await createRun(body);
      if (!res.ok || !res.data?.runId) {
        setError(res.error ?? 'Failed to re-issue run');
        setSubmitting(null);
        return;
      }
      onAccepted(res.data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(null);
    }
  };

  const cancel = async (): Promise<void> => {
    // §3.7 Cancel-Run: close the source run with the cancel reason.
    // Modal dismisses regardless of API success — defense in depth:
    // ledger captures the attempt, UI flips to dismissed even if the
    // API call fails so the operator isn't trapped.
    setSubmitting('cancel');
    setError(null);
    try {
      const closeRes = await closeRun(sourceRunId, 'user_cancelled_after_checkback');
      if (!closeRes.ok) {
        // Surface the error but still dismiss — the operator chose to
        // cancel; the run will close eventually via timeout or the
        // server can be retried out-of-band.
        setError(closeRes.error ?? 'Run close failed; dismissing modal regardless');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error during cancel');
    }
    onDismiss();
  };

  // Flatten alternativesByCapability into a stable display order
  const capabilityRows = payload.missingCapabilities.map(cap => ({
    capability: cap,
    alternatives: payload.alternativesByCapability[cap] ?? [],
  }));

  return (
    <div
      className="nx-checkback-modal-backdrop"
      role="dialog"
      aria-labelledby="plan-checkback-modal-title"
      aria-modal="true"
    >
      <div className="nx-checkback-modal">
        <header className="nx-checkback-modal-header">
          <h2 id="plan-checkback-modal-title" className="nx-checkback-modal-title">
            ⚠ Preferred selection can&apos;t complete this run
          </h2>
        </header>

        <div className="nx-checkback-modal-body">
          <p className="nx-checkback-modal-detail">{payload.reasonDetail}</p>

          {capabilityRows.length > 0 && (
            <section className="nx-checkback-modal-section">
              <h3 className="nx-checkback-modal-section-title">Missing capabilities</h3>
              <table className="nx-checkback-modal-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Suggested agent</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {capabilityRows.flatMap(row =>
                    row.alternatives.length === 0
                      ? [
                          <tr key={row.capability}>
                            <td className="nx-checkback-mono">{row.capability}</td>
                            <td colSpan={2}>(no alternative agent available)</td>
                          </tr>,
                        ]
                      : row.alternatives.map((alt, idx) => (
                          <tr key={`${row.capability}-${idx}`}>
                            <td className="nx-checkback-mono">{idx === 0 ? row.capability : ''}</td>
                            <td className="nx-checkback-mono">{alt.agentId}</td>
                            <td>{alt.reason}</td>
                          </tr>
                        ))
                  )}
                </tbody>
              </table>
            </section>
          )}

          {payload.recommendedSelectedAgentIds.length > 0 && (
            <p className="nx-checkback-modal-summary">
              Accepting will re-issue the run with{' '}
              <strong>{payload.recommendedSelectedAgentIds.length}</strong> recommended agent
              {payload.recommendedSelectedAgentIds.length === 1 ? '' : 's'} replacing your preferred
              selection.
            </p>
          )}
        </div>

        {error && <div className="nx-checkback-modal-error">{error}</div>}

        <footer className="nx-checkback-modal-actions">
          <button
            className="nx-btn nx-btn--approve"
            onClick={() => void acceptSuggestions()}
            disabled={submitting !== null || payload.recommendedSelectedAgentIds.length === 0}
          >
            {submitting === 'accept' ? 'Re-issuing…' : 'Accept Suggestions'}
          </button>
          <button
            className="nx-btn nx-btn--deny"
            onClick={() => void cancel()}
            disabled={submitting !== null}
          >
            {submitting === 'cancel' ? 'Cancelling…' : 'Cancel Run'}
          </button>
        </footer>
      </div>
    </div>
  );
}
