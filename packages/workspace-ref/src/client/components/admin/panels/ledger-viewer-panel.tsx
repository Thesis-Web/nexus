// packages/workspace-ref/src/client/components/admin/panels/ledger-viewer-panel.tsx
//
// CLAUDE-CODE-LEDGER-VIEWER-SPEC §3 — read-only viewer over the three
// governance ledgers (Run Ledger, Evidence Ledger, NVG Routing Trail).
//
// All data comes from /workspace/admin/ledger/* routes (admin-ledger.ts),
// which use the same auth chain as admin-writer (workspace JWT + nexus-admin
// role + X-Elevated-Session). No mock data; no redacted-but-loaded secrets;
// no admin-bearer fallback. Empty state when nothing has been written.
//
// Detail rendering:
//   - Long IDs and digests truncate to 8 chars + "…" with full value via
//     title attribute (hover) and click-to-copy.
//   - Any detail field whose key matches /secret|password|token|credential/
//     (excluding well-known harmless aliases like "keyName", "principalId")
//     is redacted unless the value clearly looks like a non-secret label.
//   - Empty content stays visible as "(empty)" so missing data is obvious.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { OBSERVABILITY_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';
import {
  getRecentRuns,
  getRunEvents,
  getEvidence,
  verifyEvidenceChain,
  getRoutingTrail,
  type AdminLedgerEntry,
  type AdminLedgerRunSummary,
  type AdminEvidenceRecord,
  type AdminEvidenceVerifyResult,
  type AdminTrailEntry,
} from '../../../admin-ledger-api.js';

type Tab = 'run_events' | 'evidence' | 'routing_trail';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId: string;
}

// ── Small renderers ────────────────────────────────────────────────────────

const SHORT_ID_LEN = 8;

/** Truncate long IDs / digests to 8 chars + ellipsis. Click to copy full. */
function ShortId({ value, label }: { value: string | null; label?: string }) {
  if (value === null || value === undefined || value === '') {
    return <span className="nx-ledger-empty">(empty)</span>;
  }
  const short = value.length > SHORT_ID_LEN + 1 ? `${value.slice(0, SHORT_ID_LEN)}…` : value;
  const onCopy = () => {
    void navigator.clipboard?.writeText(value).catch(() => {});
  };
  return (
    <code
      className="nx-ledger-id"
      title={`${label ? label + ': ' : ''}${value} (click to copy)`}
      onClick={onCopy}
    >
      {short}
    </code>
  );
}

function Timestamp({ value }: { value: string }) {
  if (!value) return <span className="nx-ledger-empty">(no timestamp)</span>;
  // Format as HH:MM:SS.mmm — full date in title for context.
  const d = new Date(value);
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return (
    <code className="nx-ledger-ts" title={value}>
      {hh}:{mm}:{ss}.{ms}
    </code>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const delta = Math.floor((Date.now() - t) / 1000);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

// ── Secret redaction ────────────────────────────────────────────────────────

const SECRET_KEY_RE = /(secret|password|token|credential|api[_-]?key)/i;
/**
 * Allow-list of fields that LOOK secret-y but are intentionally label-only.
 * `keyName` is the public identifier of a stored secret (e.g.
 * "OPENAI_API_KEY"); `tokenId` and `apiKeyId` are short IDs not values.
 * `signature`/`recordHash`/`previousHash` carry public hashes (the
 * Evidence Ledger is signed-and-public by design); these stay visible.
 */
const SECRET_KEY_ALLOWLIST = new Set([
  'keyname',
  'principalid',
  'storagelabel',
  'sessionid',
  'workspacesessionid',
  'tokenid',
  'apikeyid',
  'signature',
  'recordhash',
  'previoushash',
  'recordid',
  'sigversion',
  'signedby',
]);

function shouldRedact(key: string, value: unknown): boolean {
  const k = key.toLowerCase();
  if (SECRET_KEY_ALLOWLIST.has(k)) return false;
  if (!SECRET_KEY_RE.test(k)) return false;
  // Primitive values that look like a label (short, no separators) are
  // probably names rather than raw secrets — surface them.
  if (typeof value === 'string' && value.length < 32 && !/[=:/]/.test(value)) {
    return false;
  }
  return true;
}

/** Format a single detail value for display. */
function formatValue(key: string, value: unknown): string {
  if (shouldRedact(key, value)) return '«redacted»';
  if (value === null) return 'null';
  if (value === undefined) return '(undefined)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isLongId(value: string): boolean {
  // UUID-shaped or hex digest — 16+ chars and no spaces.
  return value.length >= 16 && !/\s/.test(value);
}

function DetailRow({ k, v }: { k: string; v: unknown }) {
  const formatted = formatValue(k, v);
  const isRedacted = formatted === '«redacted»';
  const long = !isRedacted && isLongId(formatted);
  return (
    <div className="nx-ledger-detail-row">
      <span className="nx-ledger-detail-key">{k}:</span>{' '}
      {long ? (
        <ShortId value={formatted} label={k} />
      ) : (
        <span
          className={isRedacted ? 'nx-ledger-redacted' : 'nx-ledger-detail-value'}
          title={formatted.length > 80 ? formatted : undefined}
        >
          {formatted.length > 200 ? `${formatted.slice(0, 200)}…` : formatted}
        </span>
      )}
    </div>
  );
}

// ── Status pill ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AdminLedgerRunSummary['status'] }) {
  return <span className={`nx-ledger-status nx-ledger-status--${status}`}>{status}</span>;
}

function eventClass(eventType: string): string {
  if (
    eventType === 'plan_rejected' ||
    eventType === 'node_failed' ||
    eventType === 'dag_failed' ||
    eventType === 'run_cancelled'
  ) {
    return 'nx-ledger-event--error';
  }
  if (
    eventType === 'plan_checkback_required' ||
    eventType === 'plan_checkback_sent' ||
    eventType === 'plan_checkback_resolved'
  ) {
    return 'nx-ledger-event--pending';
  }
  if (
    eventType === 'run_closed' ||
    eventType === 'final_response' ||
    eventType === 'dag_completed' ||
    eventType === 'compile_triggered'
  ) {
    return 'nx-ledger-event--success';
  }
  return 'nx-ledger-event--info';
}

// ── Tab content panes ──────────────────────────────────────────────────────

function RunEventsPane({ events }: { events: readonly AdminLedgerEntry[] }) {
  if (events.length === 0) {
    return <div className="nx-ledger-empty-pane">No run-ledger entries for this run.</div>;
  }
  return (
    <ol className="nx-ledger-events">
      {events.map(e => (
        <li key={e.entryId} className={`nx-ledger-event ${eventClass(e.eventType)}`}>
          <header className="nx-ledger-event-head">
            <Timestamp value={e.timestamp} />{' '}
            <span className="nx-ledger-event-type">{e.eventType}</span>
            {e.actorId !== null ? (
              <>
                {' '}
                · <span className="nx-ledger-event-actor">actor</span>{' '}
                <ShortId value={e.actorId} label="actorId" />
              </>
            ) : null}
          </header>
          {Object.keys(e.detail ?? {}).length > 0 ? (
            <div className="nx-ledger-event-detail">
              {Object.entries(e.detail).map(([k, v]) => (
                <DetailRow key={k} k={k} v={v} />
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function EvidencePane({
  records,
  truncated,
}: {
  records: readonly AdminEvidenceRecord[];
  truncated: boolean;
}) {
  if (records.length === 0) {
    return (
      <div className="nx-ledger-empty-pane">
        No evidence records for this run.
        <br />
        <span className="nx-ledger-hint">
          NXS may be running in observe mode (no evidence records produced) — check the Modes &amp;
          Policy panel.
        </span>
      </div>
    );
  }
  return (
    <>
      {truncated ? (
        <div className="nx-ledger-warning">
          Evidence scan was truncated to the most recent records — older entries may exist but were
          not loaded.
        </div>
      ) : null}
      <ol className="nx-ledger-events">
        {records.map(r => (
          <li key={r.recordId} className="nx-ledger-event nx-ledger-event--info">
            <header className="nx-ledger-event-head">
              <code className="nx-ledger-seq">#{r.ledgerSequence}</code>{' '}
              <span className="nx-ledger-event-type">evidence</span> · outcome{' '}
              <span className="nx-ledger-event-actor">{String(r.finalOutcome)}</span>
            </header>
            <div className="nx-ledger-event-detail">
              <DetailRow k="recordId" v={r.recordId} />
              <DetailRow k="actionId" v={r.actionId} />
              <DetailRow k="policyOutcome" v={r.policyOutcome} />
              <DetailRow k="recordHash" v={r.recordHash} />
              <DetailRow k="previousHash" v={r.previousHash} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function TrailPane({ entries }: { entries: readonly AdminTrailEntry[] }) {
  if (entries.length === 0) {
    return <div className="nx-ledger-empty-pane">No NVG routing trail entries for this run.</div>;
  }
  return (
    <ol className="nx-ledger-events">
      {entries.map(t => (
        <li
          key={t.entryId}
          className={`nx-ledger-event ${
            t.denialCode ? 'nx-ledger-event--error' : 'nx-ledger-event--info'
          }`}
        >
          <header className="nx-ledger-event-head">
            <Timestamp value={t.timestamp} />{' '}
            <span className="nx-ledger-event-type">{t.direction}</span> · class{' '}
            <span className="nx-ledger-event-actor">{t.dataClassification}</span>{' '}
            {t.denialCode ? (
              <>
                · <span className="nx-ledger-redacted">{t.denialCode}</span>
              </>
            ) : null}
          </header>
          <div className="nx-ledger-event-detail">
            <DetailRow k="modelTierSelected" v={t.modelTierSelected} />
            <DetailRow k="modelTierInvoked" v={t.modelTierInvoked} />
            <DetailRow k="endpointId" v={t.endpointId} />
            <DetailRow k="modelName" v={t.modelName} />
            <DetailRow k="latencyMs" v={t.latencyMs} />
            <DetailRow k="fallbackApplied" v={t.fallbackApplied} />
            {t.denialReason ? <DetailRow k="denialReason" v={t.denialReason} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function LedgerViewerPanel({ data, elevatedSessionId }: Props) {
  const surface = data ?? OBSERVABILITY_PLACEHOLDER;

  const [runs, setRuns] = useState<readonly AdminLedgerRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('run_events');

  const [events, setEvents] = useState<readonly AdminLedgerEntry[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [evidence, setEvidence] = useState<readonly AdminEvidenceRecord[]>([]);
  const [evidenceTruncated, setEvidenceTruncated] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const [trail, setTrail] = useState<readonly AdminTrailEntry[]>([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);

  const [verifyResult, setVerifyResult] = useState<AdminEvidenceVerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // ── Load recent runs ────────────────────────────────────────────────────
  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await getRecentRuns(elevatedSessionId, 20);
      if (res.ok && res.data) {
        setRuns(res.data.runs);
        // Auto-select the most recent run when none is selected, or when
        // the previously selected run has fallen out of the tail window.
        if (res.data.runs.length > 0) {
          const stillThere = selectedRunId && res.data.runs.some(r => r.runId === selectedRunId);
          if (!stillThere) {
            setSelectedRunId(res.data.runs[0]!.runId);
          }
        } else {
          setSelectedRunId(null);
        }
      } else {
        setRunsError(res.error ?? 'Failed to load runs');
      }
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunsLoading(false);
    }
    // selectedRunId intentionally excluded — we don't want re-runs to thrash
    // when the user clicks a different run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevatedSessionId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // ── Load per-run details when selection changes ─────────────────────────
  useEffect(() => {
    if (!selectedRunId) {
      setEvents([]);
      setEvidence([]);
      setTrail([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const res = await getRunEvents(elevatedSessionId, selectedRunId);
        if (cancelled) return;
        if (res.ok && res.data) {
          setEvents(res.data.events);
        } else {
          setEventsError(res.error ?? 'Failed to load events');
          setEvents([]);
        }
      } catch (err) {
        if (!cancelled) {
          setEventsError(err instanceof Error ? err.message : String(err));
          setEvents([]);
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    void (async () => {
      setEvidenceLoading(true);
      setEvidenceError(null);
      try {
        const res = await getEvidence(elevatedSessionId, { runId: selectedRunId });
        if (cancelled) return;
        if (res.ok && res.data) {
          setEvidence(res.data.records);
          setEvidenceTruncated(Boolean(res.data.truncated));
        } else {
          setEvidenceError(res.error ?? 'Failed to load evidence');
          setEvidence([]);
        }
      } catch (err) {
        if (!cancelled) {
          setEvidenceError(err instanceof Error ? err.message : String(err));
          setEvidence([]);
        }
      } finally {
        if (!cancelled) setEvidenceLoading(false);
      }
    })();
    void (async () => {
      setTrailLoading(true);
      setTrailError(null);
      try {
        const res = await getRoutingTrail(elevatedSessionId, selectedRunId);
        if (cancelled) return;
        if (res.ok && res.data) {
          setTrail(res.data.entries);
        } else {
          setTrailError(res.error ?? 'Failed to load routing trail');
          setTrail([]);
        }
      } catch (err) {
        if (!cancelled) {
          setTrailError(err instanceof Error ? err.message : String(err));
          setTrail([]);
        }
      } finally {
        if (!cancelled) setTrailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, elevatedSessionId]);

  // ── Chain verify ────────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      const res = await verifyEvidenceChain(elevatedSessionId);
      if (res.ok && res.data) {
        setVerifyResult(res.data);
      } else {
        setVerifyError(res.error ?? 'Chain verification failed');
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyLoading(false);
    }
  }, [elevatedSessionId]);

  const selectedSummary = useMemo(
    () => runs.find(r => r.runId === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  return (
    <PanelChrome surface={surface}>
      <div className="nx-ledger-toolbar">
        <button
          type="button"
          className="nx-btn"
          onClick={() => void loadRuns()}
          disabled={runsLoading}
        >
          {runsLoading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="nx-btn"
          onClick={() => void handleVerify()}
          disabled={verifyLoading}
        >
          {verifyLoading ? 'Verifying chain…' : 'Verify evidence chain'}
        </button>
      </div>

      {runsError ? <div className="nx-ledger-error">{runsError}</div> : null}

      <section className="nx-ledger-section">
        <h3>Recent runs</h3>
        {runs.length === 0 && !runsLoading ? (
          <div className="nx-ledger-empty-pane">
            No runs in the ledger window. Send a prompt from the workspace to populate.
          </div>
        ) : (
          <table className="nx-ledger-runs">
            <thead>
              <tr>
                <th>Run</th>
                <th>Events</th>
                <th>Status</th>
                <th>Last activity</th>
                <th>Last event</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr
                  key={r.runId}
                  className={`nx-ledger-run-row ${
                    r.runId === selectedRunId ? 'nx-ledger-run-row--selected' : ''
                  }`}
                  onClick={() => setSelectedRunId(r.runId)}
                >
                  <td>
                    <ShortId value={r.runId} label="runId" />
                  </td>
                  <td>{r.eventCount}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td title={r.lastTimestamp}>{relativeTime(r.lastTimestamp)}</td>
                  <td>
                    <code>{r.lastEventType}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedRunId && selectedSummary ? (
        <section className="nx-ledger-section">
          <h3>
            Run <ShortId value={selectedRunId} label="runId" />{' '}
            <span className="nx-ledger-section-meta">
              · {selectedSummary.eventCount} events · {selectedSummary.status}
            </span>
          </h3>
          <div className="nx-ledger-tabs">
            <button
              type="button"
              className={`nx-ledger-tab ${tab === 'run_events' ? 'nx-ledger-tab--active' : ''}`}
              onClick={() => setTab('run_events')}
            >
              Run Events ({events.length})
            </button>
            <button
              type="button"
              className={`nx-ledger-tab ${tab === 'evidence' ? 'nx-ledger-tab--active' : ''}`}
              onClick={() => setTab('evidence')}
            >
              Evidence ({evidence.length})
            </button>
            <button
              type="button"
              className={`nx-ledger-tab ${tab === 'routing_trail' ? 'nx-ledger-tab--active' : ''}`}
              onClick={() => setTab('routing_trail')}
            >
              Routing Trail ({trail.length})
            </button>
          </div>

          {tab === 'run_events' ? (
            eventsLoading ? (
              <div className="nx-ledger-empty-pane">Loading…</div>
            ) : eventsError ? (
              <div className="nx-ledger-error">{eventsError}</div>
            ) : (
              <RunEventsPane events={events} />
            )
          ) : null}

          {tab === 'evidence' ? (
            evidenceLoading ? (
              <div className="nx-ledger-empty-pane">Loading…</div>
            ) : evidenceError ? (
              <div className="nx-ledger-error">{evidenceError}</div>
            ) : (
              <EvidencePane records={evidence} truncated={evidenceTruncated} />
            )
          ) : null}

          {tab === 'routing_trail' ? (
            trailLoading ? (
              <div className="nx-ledger-empty-pane">Loading…</div>
            ) : trailError ? (
              <div className="nx-ledger-error">{trailError}</div>
            ) : (
              <TrailPane entries={trail} />
            )
          ) : null}
        </section>
      ) : null}

      <section className="nx-ledger-section">
        <h3>Chain verification</h3>
        {verifyError ? <div className="nx-ledger-error">{verifyError}</div> : null}
        {verifyResult ? (
          <div className={`nx-ledger-verify nx-ledger-verify--${verifyResult.ok ? 'ok' : 'fail'}`}>
            <div>
              <strong>{verifyResult.ok ? 'Chain valid' : 'Chain INVALID'}</strong> ·{' '}
              {verifyResult.recordCount} records · seq {verifyResult.checkedFrom}–
              {verifyResult.checkedTo}
            </div>
            {verifyResult.errors.length > 0 ? (
              <ul className="nx-ledger-verify-errors">
                {verifyResult.errors.map((e, i) => (
                  <li key={i}>
                    <code>seq {e.seq}</code> · {e.type} · {e.denialCode} — {e.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="nx-ledger-hint">
            Click <em>Verify evidence chain</em> to re-derive hashes and re-validate signatures
            across the full ledger.
          </div>
        )}
      </section>
    </PanelChrome>
  );
}
