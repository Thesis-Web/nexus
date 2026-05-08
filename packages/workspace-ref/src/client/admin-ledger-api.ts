// packages/workspace-ref/src/client/admin-ledger-api.ts
//
// CLAUDE-CODE-LEDGER-VIEWER-SPEC §2 — client for the admin ledger viewer
// routes (admin-ledger.ts). Same elevated-session header convention as
// admin-catalog-api.ts and admin-writer-api.ts.

import { getToken } from './api.js';

// ── Wire shapes (loose — server is authoritative) ──────────────────────────
//
// We do NOT redefine the contract types here because they're not exported
// to the client bundle (Layer 2 → server). The viewer renders detail as
// JSON, so a Record<string, unknown> for the open-ended fields is enough.

export interface AdminLedgerRunSummary {
  runId: string;
  eventCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  lastEventType: string;
  status: 'open' | 'completed' | 'denied' | 'cancelled' | 'error';
}

export interface AdminLedgerRunListData {
  runs: readonly AdminLedgerRunSummary[];
  tailWindow: number;
  totalEventsScanned: number;
}

export interface AdminLedgerEntry {
  entryId: string;
  runId: string;
  eventType: string;
  timestamp: string;
  actorId: string | null;
  detail: Record<string, unknown>;
}

export interface AdminLedgerRunEventsData {
  runId: string;
  events: readonly AdminLedgerEntry[];
  eventCount: number;
}

/** Evidence record — server returns the full §12.3.20 shape. The viewer
 *  surfaces a subset; the rest is rendered as JSON in the expanded row. */
export interface AdminEvidenceRecord extends Record<string, unknown> {
  recordId: string;
  actionId: string;
  runId: string;
  ledgerSequence: number;
  policyOutcome: string;
  finalOutcome: string;
  recordHash: string;
  previousHash: string;
}

export interface AdminEvidenceData {
  records: readonly AdminEvidenceRecord[];
  from?: number;
  to?: number;
  latestSequence?: number;
  scannedFrom?: number;
  scannedTo?: number;
  truncated?: boolean;
}

export interface AdminEvidenceVerifyResult {
  ok: boolean;
  checkedFrom: number;
  checkedTo: number;
  recordCount: number;
  errors: ReadonlyArray<{
    seq: number;
    type: 'hash_chain_break' | 'signature_invalid' | 'sequence_anomaly';
    denialCode: string;
    detail: string;
  }>;
}

export interface AdminTrailEntry extends Record<string, unknown> {
  entryId: string;
  runId: string;
  correlationId: string;
  direction: 'outbound' | 'inbound';
  actorId: string;
  octLevel: string;
  dataClassification: string;
  modelTierSelected: string | null;
  modelTierInvoked: string | null;
  endpointId: string | null;
  adapterId: string | null;
  modelName: string | null;
  denialCode: string | null;
  denialReason: string | null;
  fallbackApplied: boolean;
  latencyMs: number;
  timestamp: string;
}

export interface AdminTrailData {
  entries: readonly AdminTrailEntry[];
}

// ── Internals ──────────────────────────────────────────────────────────────

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function ledgerFetch<T>(path: string, elevatedSessionId: string): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'X-Elevated-Session': elevatedSessionId,
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if ('data' in obj || 'error' in obj) return parsed as ApiResponse<T>;
  }
  return { ok: false, error: `HTTP ${res.status}` };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** List the most recent runs (grouped from the run-ledger tail). */
export async function getRecentRuns(
  elevatedSessionId: string,
  limit = 20
): Promise<ApiResponse<AdminLedgerRunListData>> {
  return ledgerFetch<AdminLedgerRunListData>(
    `/workspace/admin/ledger/runs${buildQuery({ limit })}`,
    elevatedSessionId
  );
}

/** Fetch every Run Ledger event for a specific runId. */
export async function getRunEvents(
  elevatedSessionId: string,
  runId: string
): Promise<ApiResponse<AdminLedgerRunEventsData>> {
  return ledgerFetch<AdminLedgerRunEventsData>(
    `/workspace/admin/ledger/runs/${encodeURIComponent(runId)}`,
    elevatedSessionId
  );
}

/** Fetch evidence records — by runId (capped scan) or by sequence range. */
export async function getEvidence(
  elevatedSessionId: string,
  params: { runId?: string; from?: number; to?: number } = {}
): Promise<ApiResponse<AdminEvidenceData>> {
  return ledgerFetch<AdminEvidenceData>(
    `/workspace/admin/ledger/evidence${buildQuery(params)}`,
    elevatedSessionId
  );
}

/** Re-verify the evidence chain over a sequence range. */
export async function verifyEvidenceChain(
  elevatedSessionId: string,
  from?: number,
  to?: number
): Promise<ApiResponse<AdminEvidenceVerifyResult>> {
  return ledgerFetch<AdminEvidenceVerifyResult>(
    `/workspace/admin/ledger/evidence/verify${buildQuery({ from, to })}`,
    elevatedSessionId
  );
}

/** Routing trail — by runId or recent tail. */
export async function getRoutingTrail(
  elevatedSessionId: string,
  runId?: string
): Promise<ApiResponse<AdminTrailData>> {
  return ledgerFetch<AdminTrailData>(
    `/workspace/admin/ledger/trail${buildQuery({ runId })}`,
    elevatedSessionId
  );
}
