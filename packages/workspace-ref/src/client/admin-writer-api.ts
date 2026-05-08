// packages/workspace-ref/src/client/admin-writer-api.ts
// SPEC-ADMIN-WRITER §4–§6 — client-side fetch helpers for admin writer routes.
// Follows the same pattern as admin-setup-api.ts.
// All requests require elevated session (X-Elevated-Session header).

import { getToken } from './api.js';

/** Standard API response envelope. */
interface WriterResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function writerFetch<T>(
  path: string,
  elevatedSessionId: string,
  method: string,
  body?: unknown
): Promise<WriterResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Elevated-Session': elevatedSessionId,
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if ('data' in obj || 'error' in obj) return parsed as WriterResponse<T>;
    if (obj['ok'] === true) return { ok: true, data: parsed as T };
    if (obj['ok'] === false) {
      return { ok: false, error: String(obj['error'] ?? `HTTP ${res.status}`) };
    }
  }
  return { ok: false, error: `HTTP ${res.status}` };
}

// ── Surface 1: Model Endpoints ──────────────────────────────────────────────

export interface EndpointWriteResult {
  endpointId: string;
  healthy?: boolean;
  requiresRestart: boolean;
}

export async function addEndpoint(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<EndpointWriteResult>> {
  return writerFetch('/workspace/admin/setup/endpoints', elevatedSessionId, 'POST', payload);
}

export async function updateEndpoint(
  elevatedSessionId: string,
  endpointId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<EndpointWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/endpoints/${encodeURIComponent(endpointId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeEndpoint(
  elevatedSessionId: string,
  endpointId: string
): Promise<WriterResponse<{ endpointId: string; removed: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/endpoints/${encodeURIComponent(endpointId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 2: Actors & Agents ──────────────────────────────────────────────

export interface ActorWriteResult {
  actorId: string;
  requiresRestart: boolean;
}

export async function addActor(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ActorWriteResult>> {
  return writerFetch('/workspace/admin/setup/actors', elevatedSessionId, 'POST', payload);
}

export async function updateActor(
  elevatedSessionId: string,
  actorId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ActorWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/actors/${encodeURIComponent(actorId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function deleteActor(
  elevatedSessionId: string,
  actorId: string
): Promise<WriterResponse<{ actorId: string; deleted: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/actors/${encodeURIComponent(actorId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 3: Connectors ───────────────────────────────────────────────────

export interface ConnectorWriteResult {
  connectorId: string;
  requiresRestart: boolean;
}

export async function addConnector(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ConnectorWriteResult>> {
  return writerFetch('/workspace/admin/setup/connectors', elevatedSessionId, 'POST', payload);
}

export async function updateConnector(
  elevatedSessionId: string,
  connectorId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ConnectorWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/connectors/${encodeURIComponent(connectorId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeConnector(
  elevatedSessionId: string,
  connectorId: string
): Promise<WriterResponse<{ connectorId: string; removed: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/connectors/${encodeURIComponent(connectorId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 4: Admin Secret Onboarding ─────────────────────────────────────
// CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — operator pastes API keys directly
// into the dashboard; backing store is keys/secrets.json (gitignored).
// Status returns presence + source per key, NEVER values.

export interface SecretStatusEntry {
  keyName: string;
  present: boolean;
  source: 'file' | 'env' | null;
}

export interface SecretStatusResponse {
  keys: readonly SecretStatusEntry[];
  storageLabel: string | null;
}

export interface SecretWriteResult {
  keyName: string;
  stored: true;
  source: 'file';
  storageLabel: string;
}

export async function getSecretStatus(
  elevatedSessionId: string
): Promise<WriterResponse<SecretStatusResponse>> {
  return writerFetch('/workspace/admin/setup/secrets/status', elevatedSessionId, 'GET');
}

export async function storeSecret(
  elevatedSessionId: string,
  keyName: string,
  keyValue: string
): Promise<WriterResponse<SecretWriteResult>> {
  return writerFetch('/workspace/admin/setup/secrets', elevatedSessionId, 'POST', {
    keyName,
    keyValue,
  });
}

export async function deleteSecret(
  elevatedSessionId: string,
  keyName: string
): Promise<WriterResponse<{ keyName: string; removed: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/secrets/${encodeURIComponent(keyName)}`,
    elevatedSessionId,
    'DELETE'
  );
}
