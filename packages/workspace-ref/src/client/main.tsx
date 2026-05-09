// packages/workspace-ref/src/client/main.tsx
// AMEND-nexus-spec-workspace-v1-1-1 §1.1
// SPEC-addendum-beta1-admin-dashboard-v0-1 §2.1 — auth state machine.
// Owner ruling SCOPE-A01 (2026-05-06): real /admin URL route, no router dep.
// Owner ruling OR-001/OR-002 (2026-05-06): admin gate via 'nexus-admin' role.
//
// OD-WS-003: Minimal Vite+React consumer of routes/events.
// Must display FinalResponseArtifact as opaque governed artifact [GWS4-AUD-02].

import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './admin-styles.css';

import { useAuth } from './hooks/use-auth.js';
import { useRunEvents } from './hooks/use-run-events.js';
import { useMe } from './hooks/use-me.js';
import { useElevatedSession } from './hooks/use-elevated-session.js';
import { useRoute } from './hooks/use-route.js';
import { Login } from './components/login.js';
import { Sidebar } from './components/sidebar.js';
import { PromptPanel, type PromptSubmission } from './components/prompt-panel.js';
import { RunDisplay } from './components/run-display.js';
import { AdminEntryButton } from './components/admin/admin-entry-button.js';
import { AdminReauthGate } from './components/admin/admin-reauth-gate.js';
import { AdminDashboardShell } from './components/admin/admin-dashboard-shell.js';
import { createRun, listAgents, listModels, uploadFile, type CatalogItem } from './api.js';
import { computeRunTimeline } from './components/run-stage-reducer.js';

// ── Run entry for sidebar ─────────────────────────────────────────────────

type RunOutcome = 'success' | 'denied' | 'error';

interface RunEntry {
  runId: string;
  title: string;
  status: 'open' | 'closed';
  timestamp: string;
  /** Final outcome — only set once the run has closed. */
  outcome?: RunOutcome;
}

interface FileEntry {
  fileId: string;
  filename: string;
}

// ── App ───────────────────────────────────────────────────────────────────

function App() {
  const auth = useAuth();
  const me = useMe(auth.authenticated);
  const elev = useElevatedSession();
  const { route, navigate } = useRoute();
  const runEvents = useRunEvents();

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [agents, setAgents] = useState<CatalogItem[]>([]);
  const [models, setModels] = useState<CatalogItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [planRejection, setPlanRejection] = useState<{
    reason: string;
    reasonDetail: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load catalogs on auth (workspace view).
  useEffect(() => {
    if (!auth.authenticated) return;
    void (async () => {
      const [agentRes, modelRes] = await Promise.all([listAgents(), listModels()]);
      if (agentRes.ok && agentRes.data) setAgents(agentRes.data);
      if (modelRes.ok && modelRes.data) setModels(modelRes.data);
    })();
  }, [auth.authenticated]);

  // Acceptance gate #1: non-admin users may not enter /admin route.
  // If a non-admin reaches /admin (deep link / refresh / popstate), bounce home.
  useEffect(() => {
    if (route === 'admin' && !me.loading && !me.isAdmin) {
      navigate('workspace');
    }
  }, [route, me.loading, me.isAdmin, navigate]);

  // Handle run selection
  const handleSelectRun = useCallback(
    (runId: string) => {
      setActiveRunId(runId);
      runEvents.subscribe(runId);
    },
    [runEvents]
  );

  // Handle prompt submission → POST /workspace/runs
  //
  // CLAUDE-CODE-FIX-SSE-AND-PLAN-REVIEW BUG-1: subscribe MUST happen for
  // every successfully-created run so the timeline can render, including
  // after a previous run was denied. The server-side fix guarantees the
  // POST returns `{ ok:true, runId }` whenever the run was created on disk;
  // here we always invoke `runEvents.subscribe(runId)` on that path. If the
  // POST itself fails (network/5xx), surface the error in the UI rather
  // than swallowing it.
  const handleSubmit = useCallback(
    async (submission: PromptSubmission) => {
      setSubmitting(true);
      setPlanRejection(null);
      setSubmitError(null);
      try {
        if (!submission.agents?.length && selectedAgent) {
          submission.agents = [selectedAgent];
        }
        // Topbar model dropdown — endpointId selected by the user. Empty string
        // means "Auto (policy)"; in that case we omit preferredEndpointId so
        // the orchestrator and NVG run their normal policy-driven routing.
        if (selectedModel && !submission.preferredEndpointId) {
          submission.preferredEndpointId = selectedModel;
        }

        const res = await createRun(submission as unknown as Record<string, unknown>);
        if (res.ok && res.data) {
          const { runId, planPreview } = res.data;

          const preview = planPreview as Record<string, unknown> | null;
          if (preview && preview['rejected'] === true) {
            setPlanRejection({
              reason: (preview['reason'] as string) ?? 'unknown',
              reasonDetail: (preview['reasonDetail'] as string) ?? '',
            });
          }

          const newRun: RunEntry = {
            runId,
            title: submission.prompt.slice(0, 60) || 'Governed run',
            status: 'open',
            timestamp: new Date().toISOString(),
          };
          setRuns(prev => [newRun, ...prev]);
          setActiveRunId(runId);
          runEvents.subscribe(runId);
          // CLAUDE-CODE-FILE-ATTACH Phase A — files were just bound to
          // this run by the server; the workspace file store rejects
          // re-binding a 'bound' file to another run. Clear locally so
          // the next prompt starts with no attachments. The blob bytes
          // remain readable from the run we just started; nothing is
          // deleted, only the staging UI list.
          setFiles([]);
        } else {
          // ok:false — POST itself failed. The runId was never returned, so
          // there's nothing to subscribe to. Show the error instead of
          // silently dropping it (operator otherwise sees a dead UI).
          setSubmitError(res.error ?? 'Run creation failed (no runId returned).');
        }
      } catch (err) {
        // Network or fetch-layer failure (e.g., server killed mid-request).
        // Same surface — the operator sees the failure and can retry.
        setSubmitError(err instanceof Error ? err.message : 'Network error while creating run.');
      } finally {
        setSubmitting(false);
      }
    },
    [runEvents, selectedAgent, selectedModel]
  );

  // Handle file upload
  const handleFileUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1] ?? '';
        const res = await uploadFile(file.name, file.type || 'application/octet-stream', base64);
        if (res.ok && res.data) {
          setFiles(prev => [...prev, { fileId: res.data!.fileId, filename: file.name }]);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  // Update run status / outcome when events indicate closure. We re-run the
  // play-by-play reducer here so the sidebar reflects the same denial state
  // the timeline shows in the main pane.
  useEffect(() => {
    if (!activeRunId) return;
    const timeline = computeRunTimeline(runEvents.events);
    if (!timeline.closed) return;
    const outcome: RunOutcome = timeline.failure
      ? timeline.failure.governanceDenied
        ? 'denied'
        : 'error'
      : 'success';
    setRuns(prev =>
      prev.map(r => (r.runId === activeRunId ? { ...r, status: 'closed' as const, outcome } : r))
    );
  }, [runEvents.events, runEvents.status, activeRunId]);

  // ── Render: not authenticated ──────────────────────────────────────────

  if (!auth.authenticated) {
    return <Login onLogin={auth.login} loading={auth.loading} error={auth.error} />;
  }

  // ── Render: admin route (gated) ────────────────────────────────────────
  // SPEC §2.1 state machine: workspaceAuthenticated → adminEligible → reauth → shell.

  if (route === 'admin' && me.isAdmin) {
    if (!elev.elevatedSessionId || !elev.valid) {
      return (
        <AdminReauthGate
          principalId={me.data?.principalId ?? ''}
          onSuccess={sid => elev.set(sid)}
          onCancel={() => navigate('workspace')}
        />
      );
    }
    return (
      <AdminDashboardShell
        principalId={me.data?.principalId ?? ''}
        remainingSeconds={elev.remainingSeconds}
        elevatedSessionId={elev.elevatedSessionId ?? ''}
        onExitToWorkspace={() => navigate('workspace')}
        onLogoutElevated={() => {
          elev.clear();
          navigate('workspace');
        }}
      />
    );
  }

  // ── Render: workspace view (default) ───────────────────────────────────

  return (
    <div className="nx-app">
      {/* Top bar */}
      <header className="nx-topbar">
        <span className="nx-topbar-title">Nexus Workspace</span>
        <span className="nx-badge nx-badge--governed">Governed</span>
        <div className="nx-topbar-spacer" />
        <div className="nx-topbar-controls">
          <select
            className="nx-select"
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
          >
            <option value="">Select an agent</option>
            {agents
              .filter(a => a.selectable)
              .map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <select
            className="nx-select"
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
          >
            <option value="">Auto (policy)</option>
            {/* CLAUDE-CODE-MODEL-PREFERENCE-TRANSPARENCY §5 — show every
                visible endpoint; mark unhealthy ones disabled with a
                "(unhealthy)" suffix. The HTML `disabled` attribute keeps
                the user from selecting them while still exposing that the
                endpoint exists. Filtering by `visible` is the catalog's
                blueprint §3.4.3 separation: visible = capability-ceiling,
                selectable = currently-invokable. */}
            {models
              .filter(m => m.visible)
              .map(m => (
                <option key={m.id} value={m.id} disabled={!m.selectable}>
                  {m.name}
                  {m.selectable ? '' : ' (unhealthy)'}
                </option>
              ))}
          </select>
          <AdminEntryButton isAdmin={me.isAdmin} onClick={() => navigate('admin')} />
          <div
            className="nx-avatar"
            title={`Session: ${auth.sessionId?.slice(0, 8) ?? ''}…`}
            onClick={auth.logout}
            style={{ cursor: 'pointer' }}
          >
            {(auth.sessionId ?? 'U').charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="nx-body">
        <Sidebar
          runs={runs}
          activeRunId={activeRunId}
          files={files}
          onSelectRun={handleSelectRun}
        />

        <main className="nx-main">
          <RunDisplay
            runId={activeRunId}
            events={runEvents.events}
            status={runEvents.status}
            planRejection={planRejection}
          />

          {/* CLAUDE-CODE-FIX-SSE-AND-PLAN-REVIEW BUG-1: surface errors that
              previously failed silently. submitError covers POST-level
              failures (network/5xx); runEvents.error covers SSE failures
              (mint failed, stream dropped). Without these the operator
              would see a frozen UI and assume the system hung. */}
          {submitError ? (
            <div className="nx-error-banner" role="alert">
              <strong>Run not created:</strong> {submitError}
              <button
                type="button"
                className="nx-error-banner-close"
                onClick={() => setSubmitError(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
          {!submitError && runEvents.error ? (
            <div className="nx-error-banner nx-error-banner--warn" role="status">
              {runEvents.error}
            </div>
          ) : null}

          <PromptPanel
            agents={agents}
            preferredEndpointId={selectedModel}
            attachedFiles={files}
            onRemoveFile={fileId => setFiles(prev => prev.filter(f => f.fileId !== fileId))}
            onSubmit={submission => void handleSubmit(submission)}
            onFileUpload={() => void handleFileUpload()}
            disabled={submitting}
          />
        </main>
      </div>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
