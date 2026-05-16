// packages/workspace-ref/src/client/api.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.2 — route consumer
// OD-WS-003: UI component internals not spec-governed.
// This client consumes the governed API surface.

/** Standard API response envelope. */
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

let _token: string | null = null;

export function setToken(t: string | null): void {
  _token = t;
}
export function getToken(): string | null {
  return _token;
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  if (!headers['Content-Type'] && opts.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...opts, headers });
  return res.json() as Promise<ApiResponse<T>>;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export interface LoginResult {
  token: string;
  workspaceAuthSessionId: string;
  expiresAt: string;
}

export async function login(type: string, value: string): Promise<ApiResponse<LoginResult>> {
  return apiFetch('/workspace/auth/login', {
    method: 'POST',
    body: JSON.stringify({ type, value }),
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────

export interface RunResult {
  runId: string;
  planPreview?: unknown;
}

export interface RunStatus {
  runId: string;
  eventCount: number;
  eventTypes: string[];
  status: 'open' | 'closed';
  lastEvent: string | null;
  rejection?: { reason: string; reasonDetail: string } | null;
}

export async function createRun(input: Record<string, unknown>): Promise<ApiResponse<RunResult>> {
  return apiFetch('/workspace/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + §6.2 Commit 8.
 *
 * Closes a run from the operator side. Used by the
 * `PlanCheckbackModal` for both the Accept-Suggestions and Cancel-Run
 * paths after a preferred-agents preflight rejection.
 *
 * Server emits a `run_cancelled` ledger event with the supplied reason.
 * Idempotent (calling twice is harmless — the run is already closed
 * from the first call's perspective; subsequent ledger events are
 * audit-only).
 */
export type CloseRunReason = 'user_cancelled_after_checkback' | 'user_accepted_checkback_reissued';

export async function closeRun(
  runId: string,
  reason: CloseRunReason
): Promise<ApiResponse<{ ok: true }>> {
  return apiFetch(`/workspace/runs/${runId}/close`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function getRunStatus(runId: string): Promise<ApiResponse<RunStatus>> {
  return apiFetch(`/workspace/runs/${runId}`);
}

// ── Files ─────────────────────────────────────────────────────────────────

export interface FileResult {
  fileId: string;
  sha256: string;
}

export async function uploadFile(
  filename: string,
  mediaType: string,
  dataBase64: string
): Promise<ApiResponse<FileResult>> {
  return apiFetch('/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ filename, mediaType, data: dataBase64 }),
  });
}

// ── Catalogs ──────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  selectable: boolean;
  reason?: string;
}

export async function listAgents(): Promise<ApiResponse<CatalogItem[]>> {
  return apiFetch('/workspace/catalogs/agents');
}

export async function listModels(): Promise<ApiResponse<CatalogItem[]>> {
  return apiFetch('/workspace/catalogs/models');
}

export async function listConnectors(): Promise<ApiResponse<CatalogItem[]>> {
  return apiFetch('/workspace/catalogs/connectors');
}

// AMEND-nexus-admin-arc4-fixups §1.2 — workspace selector client.
// Mirrors listAgents / listModels exactly. Server route returns only
// enabled workspaces; UI defaults to "" (Auto = server falls back to
// first-enabled, preserving current behavior).
export async function listWorkspaces(): Promise<ApiResponse<CatalogItem[]>> {
  return apiFetch('/workspace/catalogs/workspaces');
}

export async function listRails(elevatedSessionId: string): Promise<ApiResponse<unknown[]>> {
  return apiFetch('/workspace/catalogs/rails', {
    headers: { 'X-Elevated-Session': elevatedSessionId } as Record<string, string>,
  });
}

// ── Templates ─────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<ApiResponse<unknown[]>> {
  return apiFetch('/workspace/templates');
}

// ── Event Tickets ─────────────────────────────────────────────────────────

export interface EventTicketResult {
  ticketId: string;
  expiresAt: string;
}

export async function mintEventTicket(runId: string): Promise<ApiResponse<EventTicketResult>> {
  return apiFetch(`/workspace/runs/${runId}/event-ticket`, { method: 'POST' });
}

// ── Approval ──────────────────────────────────────────────────────────────

export async function submitApproval(
  runId: string,
  approvalId: string,
  decision: 'approved' | 'denied',
  note?: string
): Promise<ApiResponse<unknown>> {
  return apiFetch(`/workspace/runs/${runId}/approval`, {
    method: 'POST',
    body: JSON.stringify({ approvalId, decision, ...(note ? { note } : {}) }),
  });
}

// ── Plan Checkback (CHECKBACK-spec) ───────────────────────────────────────

export async function submitCheckback(
  runId: string,
  decision: 'allow' | 'deny'
): Promise<ApiResponse<{ runId: string; decision: 'allow' | 'deny' }>> {
  return apiFetch(`/workspace/runs/${runId}/checkback`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

// ── Vault ─────────────────────────────────────────────────────────────────

export async function vaultChallenge(
  principalId: string,
  method: string
): Promise<ApiResponse<{ challengeId: string; prompt: string; expiresAt: string }>> {
  return apiFetch('/workspace/vault/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'challenge', principalId, method }),
  });
}

export async function vaultVerify(input: {
  challengeId: string;
  principalId: string;
  method: string;
  response: string;
}): Promise<ApiResponse<{ elevatedSessionId: string; expiresAt: string }>> {
  return apiFetch('/workspace/vault/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'verify', ...input }),
  });
}

export async function vaultSessionStatus(
  elevatedSessionId: string
): Promise<ApiResponse<{ valid: boolean; remainingSeconds: number; reason?: string }>> {
  return apiFetch('/workspace/vault/session', {
    headers: { 'X-Elevated-Session': elevatedSessionId } as Record<string, string>,
  });
}

// ── User profile (added for admin dashboard) ──────────────────────────────
// SPEC-addendum-beta1-admin-dashboard-v0-1 §2.2 — getMe is the admin gate input.

export interface WorkspaceMeClaims {
  roleAssignments: string[];
  capabilityCeilings: unknown[];
  environmentContext: string;
  actorClass: string;
}

export interface WorkspaceMe {
  actorId: string | null;
  principalId: string | null;
  workspaceAuthSessionId: string | null;
  expiresAt: string | null;
  claims: WorkspaceMeClaims | null;
}

export async function getMe(): Promise<ApiResponse<WorkspaceMe>> {
  return apiFetch('/workspace/me');
}
