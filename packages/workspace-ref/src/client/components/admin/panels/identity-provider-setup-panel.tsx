// packages/workspace-ref/src/client/components/admin/panels/identity-provider-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.1 — writer-enabled identity
// provider CRUD. Pattern mirrors connector-setup-panel.tsx.
//
// providerType is an open string at the wire level (matches loader). The
// form renders the four canonical discriminator types (local, oidc, saml,
// api-token) with type-aware UX; the manifest stays loadable when factory-
// registered types outside this list are present (e.g. reference_adapter).

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { IDENTITY_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  addIdentityProvider,
  removeIdentityProvider,
  updateIdentityProvider,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  onCatalogReload?: () => void;
}

interface IdentityEntry extends Record<string, unknown> {
  providerId: string;
  providerType: string;
  configuration: Record<string, unknown>;
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<IdentityEntry>[] = [
  { key: 'providerId', label: 'providerId' },
  { key: 'providerType', label: 'providerType' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];

type DiscriminatorType = 'local' | 'oidc' | 'saml' | 'api-token' | 'other';

const TYPE_LABEL: Record<DiscriminatorType, string> = {
  local: 'local (built-in)',
  oidc: 'oidc',
  saml: 'saml',
  'api-token': 'api-token',
  other: 'other (advanced — raw configuration)',
};

function defaultConfigFor(type: DiscriminatorType): Record<string, unknown> {
  switch (type) {
    case 'local':
      return { sessionTtlMinutes: 60 };
    case 'oidc':
      return {
        issuerUrl: '',
        clientId: '',
        clientSecretRef: 'file:OIDC_CLIENT_SECRET',
        redirectUri: '',
        scopes: ['openid', 'profile', 'email'],
      };
    case 'saml':
      return { entityId: '', ssoUrl: '', certPemRef: 'file:SAML_CERT_PEM' };
    case 'api-token':
      return { allowedTokenRefs: ['file:API_TOKEN_1'], rotationDays: 90 };
    case 'other':
      return {};
  }
}

export function IdentityProviderSetupPanel({ data, elevatedSessionId, onCatalogReload }: Props) {
  const surface = data ?? IDENTITY_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as IdentityEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.providerId);
  const selected = entries.find(e => e.providerId === selectedId) ?? null;

  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState<DiscriminatorType>('local');
  const [addProviderId, setAddProviderId] = useState('');
  const [addConfigJson, setAddConfigJson] = useState(
    JSON.stringify(defaultConfigFor('local'), null, 2)
  );
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  function selectType(type: DiscriminatorType) {
    setAddType(type);
    setAddConfigJson(JSON.stringify(defaultConfigFor(type), null, 2));
  }

  async function handleAdd() {
    if (!elevatedSessionId || !addProviderId) return;
    let configuration: Record<string, unknown>;
    try {
      configuration = JSON.parse(addConfigJson) as Record<string, unknown>;
    } catch {
      setFeedback({ type: 'error', msg: 'configuration must be valid JSON' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = await addIdentityProvider(elevatedSessionId, {
      providerId: addProviderId,
      providerType: addType,
      configuration,
      enabled: true,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Provider ${addProviderId} added. Restart server to apply.`,
      });
      setShowAddForm(false);
      setAddProviderId('');
      selectType('local');
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add identity provider' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeIdentityProvider(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Provider ${selectedId} removed. Restart required.` });
      setSelectedId(undefined);
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove identity provider' });
    }
  }

  async function handleToggleEnabled(target: IdentityEntry, nextEnabled: boolean) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateIdentityProvider(elevatedSessionId, target.providerId, {
      enabled: nextEnabled,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Provider ${target.providerId} ${nextEnabled ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update identity provider' });
    }
  }

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}
      <div className="nx-admin-panel__table">
        <AdminManifestTable<IdentityEntry>
          rows={entries}
          idKey="providerId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Identity provider — ${selected.providerId}` : undefined}
          secretFields={surface.secretFields}
          {...(canWrite
            ? {}
            : { disabledReason: 'Writer not available — elevated session required' })}
        />
      </div>
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + Add provider
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(selected, !selected.enabled)}
                >
                  {selected.enabled ? 'Disable' : 'Enable'} provider
                </button>
                <button type="button" disabled={busy} onClick={handleDelete}>
                  Delete selected
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add provider
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add identity provider</h4>
          <label>
            Provider ID:{' '}
            <input
              value={addProviderId}
              onChange={e => setAddProviderId(e.target.value)}
              placeholder="e.g. corp-oidc"
            />
          </label>
          <label>
            Provider type:{' '}
            <select value={addType} onChange={e => selectType(e.target.value as DiscriminatorType)}>
              {(['local', 'oidc', 'saml', 'api-token', 'other'] as DiscriminatorType[]).map(t => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Configuration (JSON):
            <textarea
              rows={10}
              value={addConfigJson}
              onChange={e => setAddConfigJson(e.target.value)}
            />
          </label>
          <p className="nx-admin-panel__hint">
            Secret references use <code>file:KEY_NAME</code> or <code>env:KEY_NAME</code>. Keys are
            managed under Toolchain &amp; Keys / secrets.
          </p>
          <div>
            <button type="button" disabled={busy || !addProviderId} onClick={handleAdd}>
              {busy ? 'Saving…' : 'Save provider'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </PanelChrome>
  );
}
