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
