// packages/workspace-ref/src/client/components/admin/panels/toolchain-keys-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.7 — admin-signing /
// control-plane / vault key registration + rotation.
//
// OR-DASH-009 preserved: this panel shows fingerprint + present pill
// + lastModified. Private material is NEVER displayed. Upload accepts
// a keypair JSON pasted into a textarea (no multipart dep added).

import { useEffect, useState } from 'react';
import { AdminSecretField } from '../primitives/admin-secret-field.js';
import { TOOLCHAIN_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  deleteAdminKey,
  listAdminKeys,
  uploadAdminKey,
  type AdminKeyListEntry,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  adminPrincipalId?: string;
  onCatalogReload?: () => void;
}

type KeyKind = 'admin-signing' | 'control-plane' | 'vault';

interface UploadDraft {
  keyKind: KeyKind;
  keyId: string;
  content: string;
}

function defaultUploadDraft(): UploadDraft {
  return { keyKind: 'admin-signing', keyId: '', content: '' };
}

export function ToolchainKeysPanel({
  data,
  elevatedSessionId,
  adminPrincipalId,
  onCatalogReload,
}: Props) {
  const surface = data ?? TOOLCHAIN_PLACEHOLDER;
  const canWrite = !!elevatedSessionId;

  const [keys, setKeys] = useState<readonly AdminKeyListEntry[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [draft, setDraft] = useState<UploadDraft>(defaultUploadDraft());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!elevatedSessionId) return;
    void (async () => {
      const res = await listAdminKeys(elevatedSessionId);
      if (res.ok && res.data) setKeys(res.data.keys);
    })();
  }, [elevatedSessionId]);

  async function refresh() {
    if (!elevatedSessionId) return;
    const res = await listAdminKeys(elevatedSessionId);
    if (res.ok && res.data) setKeys(res.data.keys);
  }

  async function handleUpload() {
    if (!elevatedSessionId || !draft.content) return;
    let body: Record<string, unknown>;
    if (draft.keyKind === 'vault') {
      body = { keyKind: 'vault', content: draft.content.trim() };
    } else {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(draft.content) as Record<string, unknown>;
      } catch {
        setFeedback({ type: 'error', msg: 'keypair content must be valid JSON' });
        return;
      }
      if (draft.keyKind === 'admin-signing') {
        if (!draft.keyId) {
          setFeedback({
            type: 'error',
            msg: 'admin-signing requires keyId (the principalId UUID)',
          });
          return;
        }
        body = { keyKind: 'admin-signing', keyId: draft.keyId, content: parsed };
      } else {
        body = { keyKind: 'control-plane', content: parsed };
      }
    }
    setBusy(true);
    setFeedback(null);
    const res = await uploadAdminKey(elevatedSessionId, body);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Key uploaded${res.data?.requiresRestart ? ' — restart server to apply' : ''}.`,
      });
      setShowUpload(false);
      setDraft(defaultUploadDraft());
      await refresh();
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to upload key' });
    }
  }

  async function handleDelete(keyId: string) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await deleteAdminKey(elevatedSessionId, keyId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Key ${keyId} deleted.` });
      await refresh();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to delete key' });
    }
  }

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}

      <div className="nx-admin-keys">
        <h3>Admin signing &amp; control-plane keys</h3>
        {!canWrite && <p className="nx-admin-panel__hint">Elevated session required to mutate.</p>}
        <table className="nx-admin-keys-table">
          <thead>
            <tr>
              <th>keyKind</th>
              <th>keyId</th>
              <th>fingerprint</th>
              <th>present</th>
              <th>lastModified</th>
              {canWrite && <th>actions</th>}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={`${k.keyKind}/${k.keyId}`}>
                <td>{k.keyKind}</td>
                <td>
                  <code>{k.keyId}</code>
                </td>
                <td>{k.fingerprint ?? '—'}</td>
                <td>{k.present ? '✓ present' : '✗ missing'}</td>
                <td>{k.lastModified ?? '—'}</td>
                {canWrite && (
                  <td>
                    {k.keyKind === 'admin-signing' && k.present ? (
                      <button
                        type="button"
                        disabled={busy || k.keyId === adminPrincipalId}
                        title={
                          k.keyId === adminPrincipalId
                            ? 'cannot delete your own signing keypair (self-lockout)'
                            : undefined
                        }
                        onClick={() => void handleDelete(k.keyId)}
                      >
                        Delete
                      </button>
                    ) : (
                      <span className="nx-admin-panel__hint">
                        {k.keyKind === 'vault' || k.keyKind === 'control-plane'
                          ? 'rotate via upload'
                          : '—'}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="nx-admin-panel__actions">
          <button type="button" disabled={busy} onClick={() => setShowUpload(!showUpload)}>
            + Upload key
          </button>
        </div>
      )}

      {showUpload && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Upload key</h4>
          <label>
            keyKind:{' '}
            <select
              value={draft.keyKind}
              onChange={e => setDraft(d => ({ ...d, keyKind: e.target.value as KeyKind }))}
            >
              <option value="admin-signing">admin-signing (per-principal)</option>
              <option value="control-plane">control-plane (singleton)</option>
              <option value="vault">vault (singleton symmetric key)</option>
            </select>
          </label>
          {draft.keyKind === 'admin-signing' && (
            <label>
              keyId (principalId UUID):{' '}
              <input
                value={draft.keyId}
                onChange={e => setDraft(d => ({ ...d, keyId: e.target.value }))}
                placeholder="00000000-0000-4000-a000-000000000001"
              />
            </label>
          )}
          <label>
            {draft.keyKind === 'vault'
              ? 'Vault key (base64url string):'
              : 'Keypair JSON ({"publicKey":"...","privateKey":"..."}):'}
            <textarea
              rows={6}
              value={draft.content}
              onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            />
          </label>
          <p className="nx-admin-panel__hint">
            Existing files are renamed <code>&lt;path&gt;.replaced-&lt;timestamp&gt;</code> as a
            one-rotation backup. File perms are set to 0600. Private material is never echoed back.
          </p>
          <div>
            <button type="button" disabled={busy || !draft.content} onClick={handleUpload}>
              {busy ? 'Saving…' : 'Save key'}
            </button>
            <button type="button" onClick={() => setShowUpload(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="nx-admin-panel__secrets">
        <h3>Detected secret references</h3>
        {surface.secretFields.length === 0 ? (
          <p>(no secret fields detected)</p>
        ) : (
          surface.secretFields.map(sf => (
            <AdminSecretField key={sf.fieldPath} fieldPath={sf.fieldPath} status={sf.status} />
          ))
        )}
      </div>
    </PanelChrome>
  );
}
