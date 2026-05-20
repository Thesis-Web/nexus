// packages/workspace-ref/src/client/components/admin/panels/lexicon-and-council-panel.tsx
//
// F4.1 SigningCouncil + F4.8 Lexicon Admin UI surface.
//
// One panel surfaces three operator tasks:
//
//   1. Open a `lexicon_mutation` SigningRequest — minimal entity creator
//      form. The first admin POSTs the entity payload; the route wraps it
//      as { kind: 'entity_add', entity: {...} } and opens a SigningRequest.
//
//   2. Sign a pending SigningRequest — list pending requests with a
//      "Sign as me" action. Server-side signing happens inside the route
//      (per feedback_signing_keys_server_side.md — the browser NEVER holds
//      the admin keypair; the route loads keys/admins/<principalId>.keypair.json
//      and constructs the signature).
//
//   3. Audit history — a short list of executed / denied / expired
//      SigningRequests so operators can confirm a 2-of-2 actually
//      dispatched.
//
// Per outline §3 K admin dashboard — every governance-significant
// mutation flows through SigningCouncil; this panel is the operator-side
// of that flow. Lexicon-authoring forms for edges / confidence / templates
// / guards are intentionally NOT in this V1 panel — the AST gate GOV-14
// only requires the routes to exist (which they do), and surfacing the
// entity form proves the end-to-end pipeline. Additional forms are a
// follow-up enhancement (HANDOFF §F non-gate items, not blocking gov
// floor).
//
// Server signs server-side (the workspace fetch does not send the admin
// keypair). For Phase 1 V1 the simplest path through the existing
// SigningCouncil surface is:
//   - Admin opens the request via the lexicon-authoring route (server
//     records `openedBy`).
//   - Server-side signing helper builds the Ed25519 signature over the
//     canonical envelope using the principal's keypair (route forges).
//
// In this panel the "Sign as me" button POSTs a small marker that the
// server interprets as "use my elevated session's keypair to sign this
// envelope server-side." The signature value sent in the request body is
// a sentinel that the back-end recognizes; the actual Ed25519 bytes are
// computed on the server side from the persisted admin keypair. This
// matches feedback_signing_keys_server_side.md (the browser never holds
// the admin keypair).

import { useEffect, useState } from 'react';
import { PanelChrome } from './_panel-chrome.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import {
  createLexiconEntity,
  listSigningRequests,
  signSigningRequest,
  type SigningRequestDisplay,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  adminPrincipalId?: string;
}

const COUNCIL_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'signing_council_lexicon',
  title: 'Signing Council & Lexicon (F4.1 / F4.8)',
  // Category 'modes_policy_oct' is the closest fit in the 11-surface
  // taxonomy — federation council aggregates the same governance
  // surface as modes + policy + OCT assign. The placeholder is shown
  // when no backend projection ships a surface for this id; the panel
  // itself is independent of the projection.
  category: 'modes_policy_oct',
  state: 'configured',
  sourcePaths: [
    'POST /workspace/admin/lexicon/entities',
    'POST /workspace/admin/signing/requests',
    'POST /workspace/admin/signing/requests/:id/signatures',
    'GET  /workspace/admin/signing/requests',
  ],
  blockers: [],
  evidence: [],
  currentConfiguredValue: {},
  secretFields: [],
  allowedActions: ['view', 'mutate_available'],
};

export function LexiconAndCouncilPanel({ data, elevatedSessionId, adminPrincipalId }: Props) {
  const surface = data ?? COUNCIL_PLACEHOLDER;
  const canWrite = Boolean(elevatedSessionId);

  // ── Entity authoring form state ───────────────────────────────────────────
  const [entityId, setEntityId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [entityType, setEntityType] = useState('ACTION_VERB');
  const [authoringBusy, setAuthoringBusy] = useState(false);
  const [authoringFeedback, setAuthoringFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // ── Council pending queue state ───────────────────────────────────────────
  const [pending, setPending] = useState<readonly SigningRequestDisplay[]>([]);
  const [history, setHistory] = useState<readonly SigningRequestDisplay[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  const reloadQueue = async (): Promise<void> => {
    if (!elevatedSessionId) return;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const pendingResp = await listSigningRequests(elevatedSessionId, { status: 'pending' });
      const executedResp = await listSigningRequests(elevatedSessionId, { status: 'executed' });
      const deniedResp = await listSigningRequests(elevatedSessionId, { status: 'denied' });
      const expiredResp = await listSigningRequests(elevatedSessionId, { status: 'expired' });
      setPending(pendingResp.ok && pendingResp.data ? pendingResp.data : []);
      const past: SigningRequestDisplay[] = [
        ...(executedResp.ok && executedResp.data ? executedResp.data : []),
        ...(deniedResp.ok && deniedResp.data ? deniedResp.data : []),
        ...(expiredResp.ok && expiredResp.data ? expiredResp.data : []),
      ].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
      setHistory(past.slice(0, 20));
      if (!pendingResp.ok) setQueueError(pendingResp.error ?? 'unknown');
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => {
    void reloadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevatedSessionId]);

  async function handleCreateEntity(): Promise<void> {
    if (!elevatedSessionId || !canWrite) return;
    if (entityId.trim().length === 0 || displayName.trim().length === 0) {
      setAuthoringFeedback({ kind: 'error', text: 'entityId + displayName required' });
      return;
    }
    setAuthoringBusy(true);
    setAuthoringFeedback(null);
    try {
      const result = await createLexiconEntity(elevatedSessionId, {
        entityId: entityId.trim(),
        displayName: displayName.trim(),
        entityType: entityType.trim(),
      });
      if (result.ok && result.data) {
        setAuthoringFeedback({
          kind: 'success',
          text:
            'SigningRequest opened (' +
            result.data.requestId +
            ') — awaiting second admin signature',
        });
        setEntityId('');
        setDisplayName('');
        await reloadQueue();
      } else {
        setAuthoringFeedback({
          kind: 'error',
          text: 'open failed: ' + (result.error ?? 'unknown'),
        });
      }
    } catch (err) {
      setAuthoringFeedback({
        kind: 'error',
        text: 'open failed: ' + (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setAuthoringBusy(false);
    }
  }

  async function handleSign(requestId: string): Promise<void> {
    if (!elevatedSessionId) return;
    setSigningId(requestId);
    try {
      // The signature value sent here is a sentinel; the server-side
      // signing helper loads keys/admins/<principalId>.keypair.json (per
      // feedback_signing_keys_server_side.md, the browser never holds
      // the admin keypair) and replaces this placeholder with a real
      // Ed25519 signature over the canonical envelope before the route
      // forwards to signingCouncil.sign(...). When the helper is not
      // configured for this session, the route returns 403 with a
      // clear message and the operator sees it in the queueError area.
      const result = await signSigningRequest(
        elevatedSessionId,
        requestId,
        'server_side_sign_request'
      );
      if (result.ok) {
        setQueueError(null);
        await reloadQueue();
      } else {
        setQueueError('sign failed: ' + (result.error ?? 'unknown'));
      }
    } catch (err) {
      setQueueError('sign failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSigningId(null);
    }
  }

  return (
    <PanelChrome surface={surface}>
      <div className="nx-admin-panel__section">
        <h3>Lexicon entity authoring</h3>
        <p className="nx-admin-panel__hint">
          Each submission opens a <code>lexicon_mutation</code> SigningRequest. The mutation lands
          only after a SECOND distinct admin signs (Q4 strict 2-of-2). The JSONL fixture is appended
          atomically; the planner hot-reloads the new line on its next read.
        </p>
        <div className="nx-admin-form">
          <label>
            entityId
            <input
              type="text"
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
              placeholder="verb_pull"
              disabled={authoringBusy || !canWrite}
            />
          </label>
          <label>
            displayName
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="pull"
              disabled={authoringBusy || !canWrite}
            />
          </label>
          <label>
            entityType
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              disabled={authoringBusy || !canWrite}
            >
              <option value="ACTION_VERB">ACTION_VERB</option>
              <option value="BUSINESS_NOUN">BUSINESS_NOUN</option>
              <option value="OPERAND">OPERAND</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleCreateEntity()}
            disabled={authoringBusy || !canWrite}
            className="nx-admin-button"
          >
            {authoringBusy ? 'Opening request…' : 'Open lexicon_mutation request'}
          </button>
          {!canWrite && (
            <span className="nx-admin-form__disabled-hint">
              (elevated session required for writer surface)
            </span>
          )}
        </div>
        {authoringFeedback && (
          <p
            className={
              authoringFeedback.kind === 'success'
                ? 'nx-admin-feedback--success'
                : 'nx-admin-feedback--error'
            }
          >
            {authoringFeedback.text}
          </p>
        )}
      </div>

      <div className="nx-admin-panel__section">
        <h3>Pending SigningRequests ({pending.length})</h3>
        {queueLoading && <p>loading…</p>}
        {queueError && <p className="nx-admin-feedback--error">{queueError}</p>}
        {pending.length === 0 && !queueLoading && (
          <p className="nx-admin-panel__hint">No pending requests.</p>
        )}
        {pending.length > 0 && (
          <table className="nx-admin-table">
            <thead>
              <tr>
                <th>requestId</th>
                <th>operation</th>
                <th>openedBy</th>
                <th>signatures</th>
                <th>action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(r => {
                const alreadySigned =
                  adminPrincipalId && r.signatures.some(s => s.principalId === adminPrincipalId);
                const youOpened = adminPrincipalId === r.openedBy;
                return (
                  <tr key={r.requestId}>
                    <td>
                      <code>{r.requestId.slice(0, 8)}…</code>
                    </td>
                    <td>{r.operation}</td>
                    <td>{r.openedBy}</td>
                    <td>
                      {r.signatures.length} / 2{alreadySigned && ' (you signed)'}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void handleSign(r.requestId)}
                        disabled={signingId !== null || !canWrite || alreadySigned || youOpened}
                        className="nx-admin-button"
                        title={
                          youOpened
                            ? 'You opened this request — a different admin must sign to satisfy 2-of-2'
                            : alreadySigned
                              ? 'You have already signed this request'
                              : 'Sign as ' + (adminPrincipalId ?? 'me') + ' (server-side)'
                        }
                      >
                        {signingId === r.requestId ? 'Signing…' : 'Sign as me'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="nx-admin-panel__section">
        <h3>Recent history</h3>
        {history.length === 0 ? (
          <p className="nx-admin-panel__hint">No completed requests yet.</p>
        ) : (
          <table className="nx-admin-table">
            <thead>
              <tr>
                <th>requestId</th>
                <th>operation</th>
                <th>status</th>
                <th>opened</th>
                <th>signers</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.requestId}>
                  <td>
                    <code>{r.requestId.slice(0, 8)}…</code>
                  </td>
                  <td>{r.operation}</td>
                  <td>{r.status}</td>
                  <td>{r.openedAt}</td>
                  <td>{r.signatures.map(s => s.principalId).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelChrome>
  );
}
