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
import type { DashboardSurfaceStatus } from '@nexus/contracts';
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
import { computeRunTimeline } from '../../run-stage-reducer.js';
import type { RunEvent } from '../../../hooks/use-run-events.js';
import { RunDagSection } from '../../run-dag-section.js';

type Tab = 'run_events' | 'evidence' | 'routing_trail' | 'dag';

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

/**
 * Friendly one-line summaries for important event shapes so operators
 * don't have to parse JSON to understand what happened. Returns null
 * when the event has no special summary; the generic detail rows render
 * underneath in either case.
 *
 * Covers (so far):
 *  - node_completed with tool-turn metadata (round-trip work)
 *  - node_failed with governance-denied or known multi-node planner
 *    failure reasons (secure_handoff_oct_mismatch, slot_read_*, etc.)
 *  - partial_result with sourceType so receipt vs nvg/nxs is
 *    immediately legible
 */
function buildEventSummary(eventType: string, detail: Record<string, unknown>): string | null {
  if (eventType === 'node_completed') {
    const cm = detail['completionMetadata'];
    if (cm !== null && cm !== undefined && typeof cm === 'object') {
      const meta = cm as Record<string, unknown>;
      const turns = meta['toolTurnCount'];
      const perTurn = meta['toolCallsPerTurn'];
      const capReached = meta['capReached'];
      const tier = meta['modelTierInvoked'];
      const parts: string[] = [];
      if (typeof turns === 'number') {
        parts.push(`${turns} tool turn${turns === 1 ? '' : 's'}`);
      }
      if (Array.isArray(perTurn) && perTurn.length > 0) {
        parts.push(`calls/turn: [${perTurn.join(', ')}]`);
      }
      if (capReached === true) {
        parts.push('⚠ cap reached');
      }
      if (typeof tier === 'string' && tier.length > 0) {
        parts.push(`tier: ${tier}`);
      }
      if (parts.length > 0) return parts.join(' · ');
    }
    return null;
  }
  if (eventType === 'node_failed') {
    const reason = detail['failureReason'];
    if (typeof reason === 'string' && reason.length > 0) {
      // Multi-node planner failure modes — label them so they don't
      // disappear into a generic detail row.
      if (reason.startsWith('secure_handoff_oct_mismatch')) {
        return '⛔ OCT clearance mismatch on secure_agent_handoff slot read';
      }
      if (reason.startsWith('slot_read_missing')) {
        return '⛔ Missing upstream mailbox item for inputSlotReads';
      }
      if (reason.startsWith('tool_turn_cap_exceeded')) {
        return '⛔ Round-trip cap reached — model still requested tools';
      }
      if (reason.startsWith('nxs_dispatch_failed')) {
        return `⛔ NXS gate denial · ${reason.slice('nxs_dispatch_failed: '.length)}`;
      }
      if (reason.startsWith('malformed_provider_response')) {
        return '⛔ Provider returned a follow-up shape the round-trip cannot continue';
      }
      // Generic governance denial — flag the reason inline.
      return `⛔ ${reason}`;
    }
    return null;
  }
  if (eventType === 'partial_result') {
    const sourceType = detail['sourceType'];
    const slotId = detail['slotId'];
    if (typeof sourceType === 'string' && typeof slotId === 'string') {
      // Receipt vs data discrimination: partial_result.detail.resultRef
      // (added in 02df348) carries the file:// URL of the mailbox
      // payload. NXS receipts use the convention <actionId>.receipt.json;
      // connector data payloads land at <actionId>.json. Path-based
      // detection is reliable for the current file-resolver convention;
      // Phase 2 may add a structured `kind` field if non-file://
      // resolvers ever land.
      const resultRef = detail['resultRef'];
      let kindLabel = '';
      if (typeof resultRef === 'string') {
        if (resultRef.endsWith('.receipt.json')) {
          kindLabel = ' · RECEIPT';
        } else if (sourceType === 'nxs_execution_result') {
          // Successful NXS connector data payloads — distinguish from
          // receipt-only writes so operators can read mailbox shape
          // at a glance.
          kindLabel = ' · DATA';
        }
      }
      return `mailbox write · ${sourceType}${kindLabel} → slot '${slotId}'`;
    }
    return null;
  }
  return null;
}

// ── Tab content panes ──────────────────────────────────────────────────────

function RunEventsPane({ events }: { events: readonly AdminLedgerEntry[] }) {
  if (events.length === 0) {
    return <div className="nx-ledger-empty-pane">No run-ledger entries for this run.</div>;
  }
  return (
    <ol className="nx-ledger-events">
      {events.map(e => {
        const summary = buildEventSummary(e.eventType, e.detail ?? {});
        return (
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
            {summary !== null ? (
              <div className="nx-ledger-event-summary" role="note">
                {summary}
              </div>
            ) : null}
            {Object.keys(e.detail ?? {}).length > 0 ? (
              <div className="nx-ledger-event-detail">
                {Object.entries(e.detail).map(([k, v]) => (
                  <DetailRow key={k} k={k} v={v} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
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
    // CLAUDE-CODE-FIX-ROUTING-TRAIL-GAP §4 — explain WHY evidence is empty.
    // Evidence is produced by Gate 07 (NXS pipeline) when an agent performs a
    // governed action against a real connector / system target. In V1 there
    // are no targeted systems wired and the workspace prompt path goes
    // through NVG (model invocation), not NXS — so the evidence ledger is
    // structurally empty for prompt runs. This is informational, not an error.
    return (
      <div className="nx-ledger-empty-state">
        <h4>No evidence records for this run.</h4>
        <p>
          Evidence is generated by the <strong>NXS pipeline</strong> (7-gate authority chain) when
          agents perform governed actions on targeted systems. In the current configuration:
        </p>
        <ul>
          <li>
            <strong>NXS mode</strong> is <code>observe</code> (not enforcing) — no evidence records
            are sealed even for actions that pass through the pipeline.
          </li>
          <li>No targeted systems or connectors are wired into agent dispatch.</li>
          <li>
            Workspace prompt runs route through <strong>NVG</strong> (model invocation) — a separate
            trail. See the <em>Routing Trail</em> tab.
          </li>
        </ul>
        <p className="nx-ledger-hint">
          Evidence records will appear here once NXS governs real agent-to-system actions.
        </p>
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

function TrailPane({
  entries,
  runStatus,
  runEvents,
}: {
  entries: readonly AdminTrailEntry[];
  runStatus: AdminLedgerRunSummary['status'] | null;
  runEvents: readonly AdminLedgerEntry[];
}) {
  if (entries.length === 0) {
    // The trail is empty for one of three reasons. Differentiate them so the
    // operator understands whether something went wrong or whether the
    // emptiness is expected.
    //
    //  1. The run was rejected before NVG dispatch (planner refused, no
    //     agent selected, etc.) — emptiness is by design.
    //  2. The run was cancelled before reaching dispatch (e.g., a checkback
    //     was denied by the user) — also by design.
    //  3. The run dispatched normally but trail entries are missing —
    //     genuine gap (data loss, e.g. trail file truncated externally).
    //     Surface this honestly; don't pretend everything is fine.
    const rejected = runEvents.some(e => e.eventType === 'plan_rejected');
    const cancelled = runEvents.some(
      e => e.eventType === 'run_cancelled' || e.eventType === 'plan_checkback_resolved'
    );
    const dispatched = runEvents.some(e => e.eventType === 'node_dispatched');

    if (rejected) {
      return (
        <div className="nx-ledger-empty-state">
          <h4>No NVG routing trail entries for this run.</h4>
          <p>
            The planner rejected this run before it reached NVG, so no routing decisions were made.
            Check the <em>Run Events</em> tab for the <code>plan_rejected</code> event detail.
          </p>
        </div>
      );
    }
    if (runStatus === 'cancelled' || (cancelled && !dispatched)) {
      return (
        <div className="nx-ledger-empty-state">
          <h4>No NVG routing trail entries for this run.</h4>
          <p>
            This run was cancelled before any NVG dispatch happened (typically a denied pre-flight
            checkback). Routing decisions are only recorded for runs that actually invoke a model.
          </p>
        </div>
      );
    }
    if (dispatched) {
      return (
        <div className="nx-ledger-empty-state">
          <h4>No NVG routing trail entries for this run.</h4>
          <p>
            Run Ledger shows this run dispatched a node, but no routing trail entries are on disk.
            Trail data may have been truncated externally — newer runs should populate normally.
          </p>
        </div>
      );
    }
    return (
      <div className="nx-ledger-empty-state">
        <h4>No NVG routing trail entries for this run.</h4>
        <p>
          NVG records routing decisions when an agent dispatches a model invocation. This run did
          not reach that stage.
        </p>
      </div>
    );
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

  // ── Derive RunDagState from the selected run's events ──
  // Reuses the same reducer the workspace's run-display uses so the
  // workspace user view and the admin observability view stay in sync.
  // The AdminLedgerEntry shape differs from RunEvent only in field
  // name (eventType vs type) — small adapter, no fetches.
  const timeline = useMemo(() => {
    const runEvents: RunEvent[] = events.map(e => ({
      type: e.eventType,
      runId: e.runId,
      detail: e.detail,
      timestamp: e.timestamp,
    }));
    return computeRunTimeline(runEvents);
  }, [events]);
  const dagAvailable = timeline.dag !== null && timeline.dag.isMultiNode;

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
            {/* DAG tab — only visible for multi-node runs. Phase 1 of
                the multi-node planner adds per-node breakdowns + slot
                flow; this tab lets operators inspect the structure of
                any run, not just their own from the workspace view. */}
            {dagAvailable && (
              <button
                type="button"
                className={`nx-ledger-tab ${tab === 'dag' ? 'nx-ledger-tab--active' : ''}`}
                onClick={() => setTab('dag')}
                title="Multi-node planner DAG breakdown"
              >
                DAG ({timeline.dag!.nodes.length})
              </button>
            )}
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
              <TrailPane
                entries={trail}
                runStatus={selectedSummary?.status ?? null}
                runEvents={events}
              />
            )
          ) : null}

          {tab === 'dag' && dagAvailable ? (
            <RunDagSection dag={timeline.dag!} runStartedAt={timeline.runStartedAt} />
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
