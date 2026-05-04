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

export function RunDisplay({ runId, events, status }: RunDisplayProps) {
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

  // Parse events into display items
  const agentResults: AgentResult[] = [];
  const approvalPrompts: ApprovalPrompt[] = [];
  let finalResponse: string | null = null;
  let agentCount = 0;

  for (const event of events) {
    if (event.type === 'agent_preview' && event.data) {
      agentResults.push({
        agentId: (event.data['agentId'] as string) ?? 'unknown',
        agentName: (event.data['agentName'] as string) ?? 'Agent',
        modelTier: (event.data['modelTier'] as string) ?? '',
        content: (event.data['content'] as string) ?? '',
        isPreview: true,
      });
    }
    if (event.type === 'approval_prompt' && event.data) {
      approvalPrompts.push({
        approvalId: (event.data['approvalId'] as string) ?? '',
        gate: (event.data['gate'] as string) ?? 'Gate 05',
        description: (event.data['description'] as string) ?? '',
        runId: event.runId,
      });
    }
    if (event.type === 'compile_complete' && event.data) {
      finalResponse = (event.data['content'] as string) ?? null;
    }
    if (event.type === 'run_status' && event.data?.['agentCount']) {
      agentCount = event.data['agentCount'] as number;
    }
  }

  const isOpen = status?.status === 'open';
  const isClosed = status?.status === 'closed';
  const hasDispatched = status?.eventTypes.includes('orchestrator_dispatched') ?? false;
  const isCompiling = status?.eventTypes.includes('compile_started') ?? false;

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
            {isCompiling
              ? 'Compiling final response…'
              : finalResponse
                ? 'Run complete'
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

        {/* Empty state for active run with no events yet */}
        {events.length === 0 && isOpen && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--nx-text-muted)' }}>
            Awaiting agent dispatch…
          </div>
        )}
      </div>
    </div>
  );
}
