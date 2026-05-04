// packages/workspace-ref/src/client/main.tsx
// AMEND-nexus-spec-workspace-v1-1-1 §1.1
// OD-WS-003: Minimal Vite+React consumer of routes/events.
// Must display FinalResponseArtifact as opaque governed artifact [GWS4-AUD-02].

import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { useAuth } from './hooks/use-auth.js';
import { useRunEvents } from './hooks/use-run-events.js';
import { Login } from './components/login.js';
import { Sidebar } from './components/sidebar.js';
import { PromptPanel, type PromptSubmission } from './components/prompt-panel.js';
import { RunDisplay } from './components/run-display.js';
import {
  createRun,
  listAgents,
  listModels,
  uploadFile,
  type CatalogItem,
} from './api.js';

// ── Run entry for sidebar ─────────────────────────────────────────────────

interface RunEntry {
  runId: string;
  title: string;
  status: 'open' | 'closed';
  timestamp: string;
}

interface FileEntry {
  fileId: string;
  filename: string;
}

// ── App ───────────────────────────────────────────────────────────────────

function App() {
  const auth = useAuth();
  const runEvents = useRunEvents();

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [agents, setAgents] = useState<CatalogItem[]>([]);
  const [models, setModels] = useState<CatalogItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load catalogs on auth
  useEffect(() => {
    if (!auth.authenticated) return;
    void (async () => {
      const [agentRes, modelRes] = await Promise.all([listAgents(), listModels()]);
      if (agentRes.ok && agentRes.data) setAgents(agentRes.data);
      if (modelRes.ok && modelRes.data) setModels(modelRes.data);
    })();
  }, [auth.authenticated]);

  // Handle run selection
  const handleSelectRun = useCallback((runId: string) => {
    setActiveRunId(runId);
    runEvents.subscribe(runId);
  }, [runEvents]);

  // Handle prompt submission → POST /workspace/runs
  const handleSubmit = useCallback(async (submission: PromptSubmission) => {
    setSubmitting(true);
    try {
      const res = await createRun(submission as unknown as Record<string, unknown>);
      if (res.ok && res.data) {
        const { runId } = res.data;

        // Add to runs list
        const newRun: RunEntry = {
          runId,
          title: submission.prompt.slice(0, 60) || 'Governed run',
          status: 'open',
          timestamp: new Date().toISOString(),
        };
        setRuns(prev => [newRun, ...prev]);
        setActiveRunId(runId);

        // Subscribe to events
        runEvents.subscribe(runId);
      }
    } catch (err) {
      console.error('Run creation failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [runEvents]);

  // Handle file upload
  const handleFileUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Read file as base64
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

  // Update run status when events indicate closure
  useEffect(() => {
    if (runEvents.status?.status === 'closed' && activeRunId) {
      setRuns(prev =>
        prev.map(r => r.runId === activeRunId ? { ...r, status: 'closed' as const } : r)
      );
    }
  }, [runEvents.status, activeRunId]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!auth.authenticated) {
    return <Login onLogin={auth.login} loading={auth.loading} error={auth.error} />;
  }

  return (
    <div className="nx-app">
      {/* Top bar */}
      <header className="nx-topbar">
        <span className="nx-topbar-title">Nexus Workspace</span>
        <span className="nx-badge nx-badge--governed">Governed</span>
        <div className="nx-topbar-spacer" />
        <div className="nx-topbar-controls">
          <select className="nx-select">
            <option>Default agent</option>
            {agents.filter(a => a.selectable).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select className="nx-select">
            <option>Auto (policy)</option>
            {models.filter(m => m.selectable).map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
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
          {/* Run display area */}
          <RunDisplay
            runId={activeRunId}
            events={runEvents.events}
            status={runEvents.status}
          />

          {/* Prompt panel */}
          <PromptPanel
            agents={agents}
            models={models}
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
    </StrictMode>,
  );
}
