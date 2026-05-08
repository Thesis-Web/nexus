// packages/workspace-ref/src/client/components/run-display.tsx
// Blueprint §3.5 (response surface), §3.5.1-3.5.5.
// Agent result cards, approval cards, run progress, FinalResponseArtifact display.

import { useState } from 'react';
import { submitApproval } from '../api.js';
import type { RunEvent } from '../hooks/use-run-events.js';

interface RunDisplayProps {
  runId: string | null;
  events: RunEvent[];
  status: { status: string; eventTypes: string[] } | null;
  planRejection?: { reason: string; reasonDetail: string } | null;
}

interface AgentResult {
  agentId: string;
  agentName: string;
  modelTier: string;
  content: string;
  isPreview: boolean;
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

  // Parse events into display items. Field name is `detail` to match the
  // server-side `RunLedgerEntry.detail` shape that the SSE bus broadcasts.
  const agentResults: AgentResult[] = [];
  const approvalPrompts: ApprovalPrompt[] = [];
  let finalResponse: string | null = null;
  let agentCount = 0;

  for (const event of events) {
    const detail = event.detail;
    if (event.type === 'agent_preview' && detail) {
      agentResults.push({
        agentId: (detail['agentId'] as string) ?? 'unknown',
        agentName: (detail['agentName'] as string) ?? 'Agent',
        modelTier: (detail['modelTier'] as string) ?? '',
        content: (detail['content'] as string) ?? '',
        isPreview: true,
      });
    }
    if (event.type === 'approval_prompt' && detail) {
      approvalPrompts.push({
        approvalId: (detail['approvalId'] as string) ?? '',
        gate: (detail['gate'] as string) ?? 'Gate 05',
        description: (detail['description'] as string) ?? '',
        runId: event.runId,
      });
    }
    // final_response is the canonical signed-artifact event from the
    // compile-return route. The composition root inlines the rendered body
    // into detail.body so the SSE fanout delivers it without a follow-up
    // fetch. compile_complete is kept as a back-compat fallback if some
    // future producer emits it directly.
    if (event.type === 'final_response' && detail) {
      const body = (detail['body'] as string) ?? null;
      if (typeof body === 'string') finalResponse = body;
    }
    if (event.type === 'compile_complete' && detail && finalResponse === null) {
      finalResponse = (detail['content'] as string) ?? null;
    }
    if (event.type === 'run_status' && detail?.['agentCount']) {
      agentCount = detail['agentCount'] as number;
    }
  }

  const isOpen = status?.status === 'open';
  const isClosed = status?.status === 'closed';
  const hasDispatched = status?.eventTypes.includes('orchestrator_dispatched') ?? false;
  const hasFinalResponse =
    finalResponse !== null || (status?.eventTypes.includes('final_response') ?? false);
  // `isCompiling` is now the strict "in flight" state: compile_started fired
  // and final_response has not landed yet. Without the second guard the main
  // pane would stay on "Compiling final response…" forever once compile
  // started, even after the artifact arrived and the run closed.
  const isCompiling =
    (status?.eventTypes.includes('compile_started') ?? false) && !hasFinalResponse;
  const isRejected =
    planRejection != null || (status?.eventTypes.includes('plan_rejected') ?? false);
  const rejectionDetail =
    planRejection?.reasonDetail ??
    (
      (status as Record<string, unknown> | null)?.['rejection'] as
        | Record<string, string>
        | undefined
    )?.reasonDetail ??
    null;

  const handleApproval = async (approvalId: string, decision: 'approved' | 'denied') => {
    setApprovalStates(s => ({ ...s, [approvalId]: decision }));
    try {
      await submitApproval(runId, approvalId, decision);
    } catch {
      setApprovalStates(s => ({ ...s, [approvalId]: 'pending' }));
    }
  };

  // Compute progress
  const stages = agentCount || 1;
  const completedStages = agentResults.length;
  const progressPct = Math.min(100, Math.round((completedStages / stages) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="nx-content">
        {/* Run status bar */}
        <div className="nx-run-status">
          <div className={`nx-status-dot ${isClosed ? 'nx-status-dot--idle' : ''}`} />
          <span className="nx-status-text">
            {isRejected
              ? `Plan rejected${rejectionDetail ? ` — ${rejectionDetail}` : ''}`
              : hasFinalResponse
                ? 'Run complete'
                : isCompiling
                  ? 'Compiling final response…'
                  : hasDispatched
                    ? `Run active — ${agentCount || '?'} agent${agentCount !== 1 ? 's' : ''} dispatched`
                    : isOpen
                      ? 'Run opened — awaiting dispatch'
                      : isClosed
                        ? 'Run closed'
                        : 'Initializing…'}
          </span>
          {hasDispatched && !finalResponse && (
            <div className="nx-progress-bars">
              {Array.from({ length: stages }).map((_, i) => (
                <div key={i} className="nx-progress-bar">
                  <div
                    className={`nx-progress-fill ${
                      i === completedStages && !finalResponse ? 'nx-progress-fill--amber' : ''
                    }`}
                    style={{
                      width: i < completedStages ? '100%' : i === completedStages ? '60%' : '0%',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent result cards */}
        {agentResults.map((result, i) => (
          <div key={i} className="nx-agent-card">
            <div className="nx-agent-card-header">
              <span className="nx-agent-card-agent">Agent: {result.agentName}</span>
              <span>·</span>
              <span className="nx-agent-card-model">{result.modelTier}</span>
              {result.isPreview && (
                <span
                  className="nx-badge"
                  style={{
                    background: 'var(--nx-blue-dim)',
                    color: 'var(--nx-blue)',
                    fontSize: '10px',
                    marginLeft: 'auto',
                  }}
                >
                  preview
                </span>
              )}
            </div>
            <div className="nx-agent-card-body">{result.content}</div>
          </div>
        ))}

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

        {/* Final response — FinalResponseArtifact display [GWS4-AUD-02] */}
        {finalResponse && (
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

        {/* Plan rejection card */}
        {isRejected && (
          <div className="nx-agent-card" style={{ borderColor: 'var(--nx-red-border, #ef4444)' }}>
            <div className="nx-agent-card-header">
              <span
                className="nx-badge"
                style={{
                  background: 'var(--nx-red-dim, #fef2f2)',
                  color: 'var(--nx-red, #ef4444)',
                }}
              >
                Rejected
              </span>
            </div>
            <div className="nx-agent-card-body">
              {rejectionDetail ||
                'No agents selected. Select an agent from the toolbar and try again.'}
            </div>
          </div>
        )}

        {/* Empty state for active run with no events yet */}
        {events.length === 0 && isOpen && !isRejected && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--nx-text-muted)' }}>
            Awaiting agent dispatch…
          </div>
        )}
      </div>
    </div>
  );
}
