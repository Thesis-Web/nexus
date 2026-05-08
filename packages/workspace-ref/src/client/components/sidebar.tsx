// packages/workspace-ref/src/client/components/sidebar.tsx
// Blueprint §3.3 (shell), §3.5.4 (file artifacts), §3.5.1 (run tracking).

type RunOutcome = 'success' | 'denied' | 'error';

interface RunEntry {
  runId: string;
  title: string;
  status: 'open' | 'closed';
  timestamp: string;
  /**
   * Final outcome — only set once the run has closed. Drives the sidebar
   * meta line color so denied / errored runs don't read as green completions.
   */
  outcome?: RunOutcome;
}

interface FileEntry {
  fileId: string;
  filename: string;
}

interface SidebarProps {
  runs: RunEntry[];
  activeRunId: string | null;
  files: FileEntry[];
  onSelectRun: (runId: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function Sidebar({ runs, activeRunId, files, onSelectRun }: SidebarProps) {
  return (
    <aside className="nx-sidebar">
      <div className="nx-sidebar-section">
        <div className="nx-sidebar-label">Runs</div>
        {runs.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--nx-text-muted)', padding: '4px 10px' }}>
            No runs yet
          </div>
        )}
        {runs.map(run => {
          const isClosed = run.status === 'closed';
          const outcome = run.outcome;
          const metaColor =
            outcome === 'denied' || outcome === 'error' ? 'var(--nx-red)' : undefined;
          const metaPrefix =
            outcome === 'denied'
              ? 'Denied'
              : outcome === 'error'
                ? 'Error'
                : isClosed
                  ? 'Completed'
                  : null;
          return (
            <div
              key={run.runId}
              className={`nx-run-item ${run.runId === activeRunId ? 'nx-run-item--active' : ''}`}
              onClick={() => onSelectRun(run.runId)}
            >
              <div
                className={`nx-run-item-title ${run.runId === activeRunId ? 'nx-run-item-title--active' : ''}`}
              >
                {!isClosed ? (
                  <span style={{ color: 'var(--nx-green)', fontWeight: 600 }}>Running…</span>
                ) : null}
                {!isClosed ? <br /> : null}
                {run.title}
              </div>
              <div
                className="nx-run-item-meta"
                style={metaColor ? { color: metaColor } : undefined}
              >
                {metaPrefix ? `${metaPrefix} — ${timeAgo(run.timestamp)}` : timeAgo(run.timestamp)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="nx-sidebar-divider" />

      <div className="nx-sidebar-section">
        <div className="nx-sidebar-label">Files</div>
        {files.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--nx-text-muted)', padding: '4px 10px' }}>
            No files
          </div>
        )}
        {files.map(f => (
          <div key={f.fileId} className="nx-file-item">
            {f.filename}
          </div>
        ))}
      </div>
    </aside>
  );
}
