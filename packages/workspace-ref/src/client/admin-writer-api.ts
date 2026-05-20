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

// ── Surface 5: Identity providers (AMEND-admin-dashboard §3.1) ──────────────

export interface IdentityProviderWriteResult {
  providerId: string;
  requiresRestart: boolean;
}

export async function addIdentityProvider(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<IdentityProviderWriteResult>> {
  return writerFetch(
    '/workspace/admin/setup/identity-providers',
    elevatedSessionId,
    'POST',
    payload
  );
}

export async function updateIdentityProvider(
  elevatedSessionId: string,
  providerId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<IdentityProviderWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/identity-providers/${encodeURIComponent(providerId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeIdentityProvider(
  elevatedSessionId: string,
  providerId: string
): Promise<WriterResponse<{ providerId: string; removed: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/identity-providers/${encodeURIComponent(providerId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 6: Approval channels (AMEND-admin-dashboard §3.2) ───────────────

export interface ApprovalChannelWriteResult {
  channelId: string;
  requiresRestart: boolean;
}

export async function addApprovalChannel(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ApprovalChannelWriteResult>> {
  return writerFetch(
    '/workspace/admin/setup/approval-channels',
    elevatedSessionId,
    'POST',
    payload
  );
}

export async function updateApprovalChannel(
  elevatedSessionId: string,
  channelId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ApprovalChannelWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/approval-channels/${encodeURIComponent(channelId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeApprovalChannel(
  elevatedSessionId: string,
  channelId: string
): Promise<WriterResponse<{ channelId: string; removed: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/approval-channels/${encodeURIComponent(channelId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 7: Orchestrators (AMEND-admin-dashboard §3.3) ───────────────────

export interface OrchestratorWriteResult {
  orchestratorSocketId: string;
  requiresRestart: boolean;
}

export async function addOrchestrator(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<OrchestratorWriteResult>> {
  return writerFetch('/workspace/admin/setup/orchestrators', elevatedSessionId, 'POST', payload);
}

export async function updateOrchestrator(
  elevatedSessionId: string,
  orchestratorSocketId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<OrchestratorWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/orchestrators/${encodeURIComponent(orchestratorSocketId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeOrchestrator(
  elevatedSessionId: string,
  orchestratorSocketId: string
): Promise<
  WriterResponse<{ orchestratorSocketId: string; removed: boolean; requiresRestart: boolean }>
> {
  return writerFetch(
    `/workspace/admin/setup/orchestrators/${encodeURIComponent(orchestratorSocketId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 8: Workspaces (AMEND-admin-dashboard §3.4) ──────────────────────

export interface WorkspaceWriteResult {
  workspaceSocketId: string;
  requiresRestart: boolean;
}

export async function addWorkspace(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<WorkspaceWriteResult>> {
  return writerFetch('/workspace/admin/setup/workspaces', elevatedSessionId, 'POST', payload);
}

export async function updateWorkspace(
  elevatedSessionId: string,
  workspaceSocketId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<WorkspaceWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/workspaces/${encodeURIComponent(workspaceSocketId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeWorkspace(
  elevatedSessionId: string,
  workspaceSocketId: string
): Promise<
  WriterResponse<{ workspaceSocketId: string; removed: boolean; requiresRestart: boolean }>
> {
  return writerFetch(
    `/workspace/admin/setup/workspaces/${encodeURIComponent(workspaceSocketId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 9: Mailboxes (AMEND-admin-dashboard §3.5.a) ─────────────────────

export interface MailboxWriteResult {
  mailboxId: string;
  requiresRestart: boolean;
}

export async function addMailbox(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<MailboxWriteResult>> {
  return writerFetch('/workspace/admin/setup/mailboxes', elevatedSessionId, 'POST', payload);
}

export async function updateMailbox(
  elevatedSessionId: string,
  mailboxId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<MailboxWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/mailboxes/${encodeURIComponent(mailboxId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeMailbox(
  elevatedSessionId: string,
  mailboxId: string
): Promise<WriterResponse<{ mailboxId: string; removed: boolean; requiresRestart: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/mailboxes/${encodeURIComponent(mailboxId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 10: Compilers (AMEND-admin-dashboard §3.5.b) ────────────────────

export interface CompilerWriteResult {
  compilerSocketId: string;
  requiresRestart: boolean;
}

export async function addCompiler(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<CompilerWriteResult>> {
  return writerFetch('/workspace/admin/setup/compilers', elevatedSessionId, 'POST', payload);
}

export async function updateCompiler(
  elevatedSessionId: string,
  compilerSocketId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<CompilerWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/compilers/${encodeURIComponent(compilerSocketId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeCompiler(
  elevatedSessionId: string,
  compilerSocketId: string
): Promise<
  WriterResponse<{ compilerSocketId: string; removed: boolean; requiresRestart: boolean }>
> {
  return writerFetch(
    `/workspace/admin/setup/compilers/${encodeURIComponent(compilerSocketId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 11: Return endpoints (AMEND-admin-dashboard §3.5.c) ─────────────

export interface ReturnEndpointWriteResult {
  returnEndpointId: string;
  requiresRestart: boolean;
}

export async function addReturnEndpoint(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ReturnEndpointWriteResult>> {
  return writerFetch('/workspace/admin/setup/return-endpoints', elevatedSessionId, 'POST', payload);
}

export async function updateReturnEndpoint(
  elevatedSessionId: string,
  returnEndpointId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<ReturnEndpointWriteResult>> {
  return writerFetch(
    `/workspace/admin/setup/return-endpoints/${encodeURIComponent(returnEndpointId)}`,
    elevatedSessionId,
    'PUT',
    payload
  );
}

export async function removeReturnEndpoint(
  elevatedSessionId: string,
  returnEndpointId: string
): Promise<
  WriterResponse<{ returnEndpointId: string; removed: boolean; requiresRestart: boolean }>
> {
  return writerFetch(
    `/workspace/admin/setup/return-endpoints/${encodeURIComponent(returnEndpointId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 12: Admin signing keys (AMEND-admin-dashboard §3.7) ─────────────

export interface AdminKeyListEntry {
  keyId: string;
  keyKind: 'admin-signing' | 'control-plane' | 'vault';
  fingerprint: string | null;
  present: boolean;
  lastModified: string | null;
}

export interface AdminKeyUploadResult {
  keyId: string;
  keyKind: 'admin-signing' | 'control-plane' | 'vault';
  fingerprint: string;
  present: true;
  requiresRestart: boolean;
}

export async function listAdminKeys(
  elevatedSessionId: string
): Promise<WriterResponse<{ keys: readonly AdminKeyListEntry[] }>> {
  return writerFetch('/workspace/admin/setup/admin-keys', elevatedSessionId, 'GET');
}

export async function uploadAdminKey(
  elevatedSessionId: string,
  payload: Record<string, unknown>
): Promise<WriterResponse<AdminKeyUploadResult>> {
  return writerFetch('/workspace/admin/setup/admin-keys', elevatedSessionId, 'POST', payload);
}

export async function deleteAdminKey(
  elevatedSessionId: string,
  keyId: string
): Promise<WriterResponse<{ keyId: string; removed: boolean }>> {
  return writerFetch(
    `/workspace/admin/setup/admin-keys/${encodeURIComponent(keyId)}`,
    elevatedSessionId,
    'DELETE'
  );
}

// ── Surface 13: Mode + unlock (AMEND-admin-dashboard §3.6) ──────────────────

export interface ModeCurrentConfig {
  nxsMode: 'observe' | 'advisory' | 'enforcing';
  nvgMode: 'observe' | 'advisory' | 'enforcing';
  enforcingLocked: boolean;
  updatedAt: string;
  updatedBy: { adminId: string; publicKey: string };
  signatureFingerprint: string;
}

export interface ModeStateResponse {
  currentConfig: ModeCurrentConfig;
  signingKeypairPresent: boolean;
}

export async function getModeState(
  elevatedSessionId: string
): Promise<WriterResponse<ModeStateResponse>> {
  return writerFetch('/workspace/admin/setup/mode', elevatedSessionId, 'GET');
}

export async function setMode(
  elevatedSessionId: string,
  engine: 'nxs' | 'nvg',
  mode: 'observe' | 'advisory' | 'enforcing'
): Promise<WriterResponse<{ currentConfig: ModeCurrentConfig }>> {
  return writerFetch('/workspace/admin/setup/mode', elevatedSessionId, 'POST', { engine, mode });
}

export async function unlockEnforcing(
  elevatedSessionId: string
): Promise<WriterResponse<{ currentConfig: ModeCurrentConfig }>> {
  return writerFetch('/workspace/admin/setup/mode/unlock', elevatedSessionId, 'POST', {
    confirm: true,
  });
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

// ── F4.1 SigningCouncil — pending requests + sign action ────────────────────

export type SigningOperationName =
  | 'mode_unlock'
  | 'policy_bundle_replace'
  | 'signing_council_change'
  | 'lexicon_mutation';

export type SigningRequestStatus = 'pending' | 'executed' | 'denied' | 'expired';

export interface SigningRequestDisplay {
  requestId: string;
  operation: SigningOperationName;
  payload: Record<string, unknown>;
  payloadDigest: string;
  openedAt: string;
  openedBy: string;
  expiresAt: string;
  signatures: ReadonlyArray<{
    principalId: string;
    signature: string;
    signedAt: string;
  }>;
  status: SigningRequestStatus;
  dispatchedAt?: string;
  denialReason?: string;
}

export async function listSigningRequests(
  elevatedSessionId: string,
  filter?: { status?: SigningRequestStatus; operation?: SigningOperationName }
): Promise<WriterResponse<readonly SigningRequestDisplay[]>> {
  const params = new URLSearchParams();
  if (filter?.status) params.append('status', filter.status);
  if (filter?.operation) params.append('operation', filter.operation);
  const suffix = params.toString().length > 0 ? '?' + params.toString() : '';
  return writerFetch('/workspace/admin/signing/requests' + suffix, elevatedSessionId, 'GET');
}

/**
 * Sign a pending SigningRequest. F4.1 /
 * feedback_signing_keys_server_side: the browser MUST NOT hold the admin
 * keypair, so this helper sends an empty body — the route loads the
 * elevated admin's server-side keypair and forges the Ed25519 signature
 * itself. External (CLI) clients pre-signing the canonical envelope
 * should call the underlying route directly with `{ signature: <bytes> }`.
 */
export async function signSigningRequest(
  elevatedSessionId: string,
  requestId: string
): Promise<WriterResponse<SigningRequestDisplay>> {
  return writerFetch(
    `/workspace/admin/signing/requests/${encodeURIComponent(requestId)}/signatures`,
    elevatedSessionId,
    'POST',
    {}
  );
}

// ── F4.8 Lexicon admin — author mutations + read fixtures ───────────────────

export interface LexiconEntityDisplay {
  entityId: string;
  displayName: string;
  entityType: string;
  disabled?: boolean;
  notes?: string;
}

export async function createLexiconEntity(
  elevatedSessionId: string,
  payload: LexiconEntityDisplay
): Promise<WriterResponse<SigningRequestDisplay>> {
  return writerFetch('/workspace/admin/lexicon/entities', elevatedSessionId, 'POST', payload);
}

export async function listLexiconEntities(
  elevatedSessionId: string
): Promise<WriterResponse<readonly unknown[]>> {
  return writerFetch('/workspace/admin/lexicon/entities', elevatedSessionId, 'GET');
}
