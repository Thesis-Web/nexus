// packages/workspace-ref/src/client/components/run-checkback-card.tsx
//
// CHECKBACK-spec Part 3 — "Plan Review Required" card.
//
// Renders when the SSE stream delivers a plan_checkback_required event
// without a corresponding plan_checkback_resolved. The user picks Allow
// Alternative or Deny; the choice is POSTed to
// /workspace/runs/:runId/checkback, which wakes the orchestrator's
// suspended sendPlanCheckback Deferred. After the click we lock the
// buttons until the resolved event lands so the user can't double-fire.

import { useState } from 'react';
import type { PendingCheckback } from './run-stage-reducer.js';
import { submitCheckback } from '../api.js';

interface RunCheckbackCardProps {
  runId: string;
  checkback: PendingCheckback;
}

export function RunCheckbackCard({ runId, checkback }: RunCheckbackCardProps) {
  const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: 'allow' | 'deny'): Promise<void> => {
    setSubmitting(decision);
    setError(null);
    try {
      const res = await submitCheckback(runId, decision);
      if (!res.ok) {
        setError(res.error ?? 'Checkback submission failed');
        setSubmitting(null);
      }
      // On success we leave the button locked — the SSE stream will deliver
      // plan_checkback_resolved, which causes the parent to drop this card
      // entirely (pendingCheckback flips to null).
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(null);
    }
  };

  const altLabel = formatAlternative(checkback);
  const allowLabel = checkback.alternativeTier ? 'Allow Alternative' : 'Allow';
  const allowDisabled = checkback.alternativeTier === null;

  return (
    <div className="nx-checkback-card" role="alert">
      <div className="nx-checkback-header">
        <span className="nx-badge nx-badge--review">⚠ Plan Review Required</span>
      </div>
      <div className="nx-checkback-message">{checkback.message}</div>

      <dl className="nx-checkback-details">
        <div className="nx-checkback-detail-row">
          <dt>Selected tier</dt>
          <dd>
            <span className="nx-checkback-mono">{checkback.primaryTier ?? 'unknown'}</span>{' '}
            <span className="nx-checkback-status nx-checkback-status--unhealthy">
              no healthy endpoints
            </span>
          </dd>
        </div>
        {altLabel && (
          <div className="nx-checkback-detail-row">
            <dt>Alternative</dt>
            <dd>{altLabel}</dd>
          </div>
        )}
        {checkback.denialReason && (
          <div className="nx-checkback-detail-row">
            <dt>Reason</dt>
            <dd className="nx-checkback-mono">{checkback.denialReason}</dd>
          </div>
        )}
      </dl>

      {error && <div className="nx-checkback-error">{error}</div>}

      <div className="nx-checkback-actions">
        <button
          className="nx-btn nx-btn--approve"
          onClick={() => void submit('allow')}
          disabled={submitting !== null || allowDisabled}
        >
          {submitting === 'allow' ? 'Submitting…' : allowLabel}
        </button>
        <button
          className="nx-btn nx-btn--deny"
          onClick={() => void submit('deny')}
          disabled={submitting !== null}
        >
          {submitting === 'deny' ? 'Submitting…' : 'Deny & New Prompt'}
        </button>
      </div>
    </div>
  );
}

function formatAlternative(checkback: PendingCheckback): string | null {
  if (!checkback.alternativeTier) return null;
  const ep = checkback.alternativeEndpoint;
  if (ep && (ep.modelName || ep.endpointId)) {
    const model = ep.modelName || 'unknown';
    const endpoint = ep.endpointId || '';
    return `Tier: ${checkback.alternativeTier} | Model: ${model}${endpoint ? ' at ' + endpoint : ''}`;
  }
  return `Tier: ${checkback.alternativeTier}`;
}
