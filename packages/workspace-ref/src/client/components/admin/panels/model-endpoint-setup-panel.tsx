// packages/workspace-ref/src/client/components/admin/panels/model-endpoint-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.3 — Model endpoint / NVG surface.
// SPEC-ADMIN-WRITER §4 — Writer-enabled (POST/PUT/DELETE).
// SPEC-ADMIN-CATALOG-EDITABLE-FORMS — dynamic dropdowns, ollama discovery,
//   inline edit, enable/disable toggle.
//
// All dropdowns are catalog-driven. Adapter list is derived from the union of
// (a) adapterIds in existing endpoint manifest entries and (b) the auth-kind
// list to seed reasonable defaults; admins can always type a custom value.
//
// Manifest mutations (add/update/delete/toggle) require restart — every
// mutation surfaces a "Restart required" feedback line.

import { useEffect, useMemo, useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { MODELS_NVG_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';
import { addEndpoint, removeEndpoint, updateEndpoint } from '../../../admin-writer-api.js';
import { discoverModels, type AdminCatalog } from '../../../admin-catalog-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  catalog?: AdminCatalog;
  onCatalogReload: () => void;
}

interface EndpointEntry extends Record<string, unknown> {
  endpointId: string;
  tier: string;
  url: string;
  adapterId: string;
  modelName: string;
  auth: Record<string, unknown>;
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<EndpointEntry>[] = [
  { key: 'endpointId', label: 'endpointId' },
  { key: 'tier', label: 'tier' },
  { key: 'modelName', label: 'model' },
  { key: 'adapterId', label: 'adapter' },
  {
    key: 'auth',
    label: 'auth.kind',
    render: v => {
      if (typeof v === 'object' && v !== null && 'kind' in (v as Record<string, unknown>)) {
        return String((v as Record<string, unknown>)['kind']);
      }
      return '—';
    },
  },
];

interface DraftEndpoint {
  endpointId: string;
  url: string;
  adapterId: string;
  modelName: string;
  tier: string;
  authKind: string;
  authSecretRef: string;
  authHeaderName: string;
  authPrefix: string;
}

const EMPTY_DRAFT: DraftEndpoint = {
  endpointId: '',
  url: '',
  adapterId: '',
  modelName: '',
  tier: '',
  authKind: 'none',
  authSecretRef: '',
  authHeaderName: '',
  authPrefix: '',
};

interface Feedback {
  type: 'success' | 'error' | 'info';
  msg: string;
}

function authToDraft(auth: Record<string, unknown> | undefined): {
  kind: string;
  secretRef: string;
  headerName: string;
  prefix: string;
} {
  if (!auth) return { kind: 'none', secretRef: '', headerName: '', prefix: '' };
  return {
    kind: typeof auth['kind'] === 'string' ? auth['kind'] : 'none',
    secretRef: typeof auth['secretRef'] === 'string' ? auth['secretRef'] : '',
    headerName: typeof auth['headerName'] === 'string' ? auth['headerName'] : '',
    prefix: typeof auth['prefix'] === 'string' ? auth['prefix'] : '',
  };
}

function draftToAuth(draft: DraftEndpoint): Record<string, unknown> {
  if (draft.authKind === 'none') return { kind: 'none' };
  const auth: Record<string, unknown> = { kind: draft.authKind };
  if (draft.authSecretRef) auth['secretRef'] = draft.authSecretRef;
  if (draft.authHeaderName) auth['headerName'] = draft.authHeaderName;
  if (draft.authPrefix) auth['prefix'] = draft.authPrefix;
  return auth;
}

function entryToDraft(entry: EndpointEntry): DraftEndpoint {
  const a = authToDraft(entry.auth);
  return {
    endpointId: entry.endpointId,
    url: entry.url,
    adapterId: entry.adapterId,
    modelName: entry.modelName,
    tier: entry.tier,
    authKind: a.kind,
    authSecretRef: a.secretRef,
    authHeaderName: a.headerName,
    authPrefix: a.prefix,
  };
}

const KNOWN_ADAPTERS: readonly string[] = [
  'ollama-chat-v1',
  'openai-chat-v1',
  'anthropic-messages-v1',
];

export function ModelEndpointSetupPanel({
  data,
  elevatedSessionId,
  catalog,
  onCatalogReload,
}: Props) {
  const surface = data ?? MODELS_NVG_PLACEHOLDER;
  const canWrite = !!elevatedSessionId;

  // Catalog drives the table. Until catalog loads, fall back to the
  // (enabled-only) surface entries from the projection — better than blank.
  const entriesFromCatalog = useMemo(() => {
    if (!catalog) return null;
    return catalog.allEndpoints as readonly EndpointEntry[];
  }, [catalog]);
  const entriesFallback = useMemo(
    () => (surface.currentConfiguredValue['entries'] as EndpointEntry[]) ?? [],
    [surface]
  );
  const entries = entriesFromCatalog ?? entriesFallback;

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  useEffect(() => {
    // Keep selectedId valid as catalog reloads. If the selected entry was
    // deleted, drop the selection; otherwise leave it alone.
    if (selectedId && !entries.some(e => e.endpointId === selectedId)) {
      setSelectedId(undefined);
    }
  }, [entries, selectedId]);
  const selected = entries.find(e => e.endpointId === selectedId) ?? null;

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Add form ───────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<DraftEndpoint>(EMPTY_DRAFT);

  // ── Edit form (mirrors selected entry while editing) ───────────────────
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftEndpoint>(EMPTY_DRAFT);
  useEffect(() => {
    if (editing && editing !== selectedId) {
      // Selection moved away from the entry being edited — abandon edit.
      setEditing(null);
    }
  }, [selectedId, editing]);

  // ── Discover state (per form: 'add' or 'edit') ──────────────────────────
  const [discoveredModels, setDiscoveredModels] = useState<{
    formId: 'add' | 'edit';
    models: readonly { name: string }[];
  } | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Adapter dropdown options: union of known adapters + adapters present in
  // existing manifest entries. Always includes "Add new…" sentinel.
  const adapterOptions = useMemo(() => {
    const fromEntries = entries.map(e => e.adapterId).filter(Boolean);
    return Array.from(new Set([...KNOWN_ADAPTERS, ...fromEntries]));
  }, [entries]);

  // Catalog tiers / auth kinds — fall back to safe defaults if catalog not loaded.
  const tierOptions = catalog?.modelTiers ?? [];
  const authKindOptions = catalog?.authKinds ?? [
    { id: 'none', label: 'none', requiresSecret: false },
    { id: 'api_key', label: 'api_key', requiresSecret: true },
    { id: 'bearer', label: 'bearer', requiresSecret: true },
  ];

  function selectedAuthKind(kind: string) {
    return authKindOptions.find(a => a.id === kind);
  }

  async function handleDiscover(formId: 'add' | 'edit', baseUrl: string, adapterId: string) {
    if (!elevatedSessionId || !baseUrl) return;
    setDiscovering(true);
    setFeedback(null);
    const res = await discoverModels(elevatedSessionId, baseUrl, adapterId);
    setDiscovering(false);
    if (res.ok && res.data) {
      setDiscoveredModels({ formId, models: res.data.models });
      setFeedback({
        type: 'info',
        msg: `Discovered ${res.data.models.length} model${res.data.models.length === 1 ? '' : 's'} at ${res.data.probedUrl}.`,
      });
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Discovery failed' });
    }
  }

  async function handleAddSubmit() {
    if (!elevatedSessionId) return;
    if (
      !addDraft.endpointId ||
      !addDraft.url ||
      !addDraft.modelName ||
      !addDraft.adapterId ||
      !addDraft.tier
    ) {
      setFeedback({
        type: 'error',
        msg: 'endpointId, url, adapter, model, and tier are required.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = await addEndpoint(elevatedSessionId, {
      endpointId: addDraft.endpointId,
      url: addDraft.url,
      adapterId: addDraft.adapterId,
      modelName: addDraft.modelName,
      tier: addDraft.tier,
      enabled: true,
      auth: draftToAuth(addDraft),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Endpoint "${addDraft.endpointId}" added. Restart required for it to come online.`,
      });
      setShowAddForm(false);
      setAddDraft(EMPTY_DRAFT);
      setDiscoveredModels(null);
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add endpoint' });
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditing(selected.endpointId);
    setEditDraft(entryToDraft(selected));
    setDiscoveredModels(null);
  }

  function cancelEdit() {
    setEditing(null);
    setEditDraft(EMPTY_DRAFT);
    setDiscoveredModels(null);
  }

  async function handleEditSave() {
    if (!elevatedSessionId || !editing) return;
    if (!editDraft.url || !editDraft.modelName || !editDraft.adapterId || !editDraft.tier) {
      setFeedback({ type: 'error', msg: 'url, adapter, model, and tier are required.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = await updateEndpoint(elevatedSessionId, editing, {
      url: editDraft.url,
      adapterId: editDraft.adapterId,
      modelName: editDraft.modelName,
      tier: editDraft.tier,
      auth: draftToAuth(editDraft),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Endpoint "${editing}" updated. Restart required for changes to take effect.`,
      });
      setEditing(null);
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update endpoint' });
    }
  }

  async function handleToggleEnabled(entry: EndpointEntry) {
    if (!elevatedSessionId) return;
    const next = !entry.enabled;
    setBusy(true);
    setFeedback(null);
    const res = await updateEndpoint(elevatedSessionId, entry.endpointId, { enabled: next });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Endpoint "${entry.endpointId}" ${next ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to toggle endpoint' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    if (!window.confirm(`Delete endpoint "${selectedId}"? This cannot be undone.`)) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeEndpoint(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Endpoint "${selectedId}" removed. Restart required.`,
      });
      setSelectedId(undefined);
      setEditing(null);
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove endpoint' });
    }
  }

  return (
    <PanelChrome surface={surface}>
      {!catalog && canWrite && (
        <div className="nx-admin-panel__feedback nx-admin-panel__feedback--info">
          Loading catalog…
        </div>
      )}
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}

      <div className="nx-admin-panel__restart-banner" role="note">
        <strong>Heads up:</strong> Endpoint changes are persisted to{' '}
        <code>config/nvg/endpoints.v1.yaml</code> and require a server restart to take effect.
      </div>

      <div className="nx-admin-panel__table">
        <AdminManifestTable<EndpointEntry>
          rows={entries}
          idKey="endpointId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* ── Selected entry — editable when admin clicks "Edit" ── */}
      {selected && (
        <div className="nx-admin-endpoint-detail">
          <div className="nx-admin-endpoint-detail__header">
            <h3 className="nx-admin-endpoint-detail__title">
              {selected.endpointId}
              <span
                className={`nx-admin-endpoint-detail__pill ${
                  selected.enabled
                    ? 'nx-admin-endpoint-detail__pill--enabled'
                    : 'nx-admin-endpoint-detail__pill--disabled'
                }`}
              >
                {selected.enabled ? 'enabled' : 'disabled'}
              </span>
            </h3>
            <div className="nx-admin-endpoint-detail__actions">
              {canWrite && editing !== selected.endpointId && (
                <>
                  <button
                    type="button"
                    className="nx-admin-btn nx-admin-btn--secondary"
                    disabled={busy}
                    onClick={startEdit}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="nx-admin-btn nx-admin-btn--secondary"
                    disabled={busy}
                    onClick={() => handleToggleEnabled(selected)}
                  >
                    {selected.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="nx-admin-btn nx-admin-btn--danger"
                    disabled={busy}
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>

          {editing === selected.endpointId ? (
            <EndpointForm
              draft={editDraft}
              setDraft={setEditDraft}
              adapterOptions={adapterOptions}
              tierOptions={tierOptions}
              authKindOptions={authKindOptions}
              selectedAuthKindRequiresSecret={
                selectedAuthKind(editDraft.authKind)?.requiresSecret ?? false
              }
              endpointIdLocked
              discovering={discovering}
              discoveredModels={
                discoveredModels?.formId === 'edit' ? discoveredModels.models : null
              }
              onDiscover={() => handleDiscover('edit', editDraft.url, editDraft.adapterId)}
              busy={busy}
              onSubmit={handleEditSave}
              onCancel={cancelEdit}
              submitLabel="Save changes"
            />
          ) : (
            <EndpointReadOnly entry={selected} />
          )}
        </div>
      )}

      {/* ── Add new endpoint ── */}
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <button
            type="button"
            className="nx-admin-btn nx-admin-btn--primary"
            disabled={busy || !catalog}
            onClick={() => {
              setShowAddForm(s => !s);
              setAddDraft(EMPTY_DRAFT);
              setDiscoveredModels(null);
            }}
          >
            {showAddForm ? 'Close add form' : '+ Add endpoint'}
          </button>
        ) : (
          <button type="button" className="nx-admin-btn" disabled title="Elevated session required">
            + Add endpoint
          </button>
        )}
      </div>

      {showAddForm && canWrite && (
        <div className="nx-admin-endpoint-form-card">
          <h4 className="nx-admin-endpoint-form-card__title">Add new endpoint</h4>
          <EndpointForm
            draft={addDraft}
            setDraft={setAddDraft}
            adapterOptions={adapterOptions}
            tierOptions={tierOptions}
            authKindOptions={authKindOptions}
            selectedAuthKindRequiresSecret={
              selectedAuthKind(addDraft.authKind)?.requiresSecret ?? false
            }
            endpointIdLocked={false}
            discovering={discovering}
            discoveredModels={discoveredModels?.formId === 'add' ? discoveredModels.models : null}
            onDiscover={() => handleDiscover('add', addDraft.url, addDraft.adapterId)}
            busy={busy}
            onSubmit={handleAddSubmit}
            onCancel={() => {
              setShowAddForm(false);
              setAddDraft(EMPTY_DRAFT);
              setDiscoveredModels(null);
            }}
            submitLabel="Add endpoint"
          />
        </div>
      )}
    </PanelChrome>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

interface FormProps {
  draft: DraftEndpoint;
  setDraft: (updater: (prev: DraftEndpoint) => DraftEndpoint) => void;
  adapterOptions: readonly string[];
  tierOptions: readonly { id: string; label: string }[];
  authKindOptions: readonly { id: string; label: string; requiresSecret: boolean }[];
  selectedAuthKindRequiresSecret: boolean;
  endpointIdLocked: boolean;
  discovering: boolean;
  discoveredModels: readonly { name: string }[] | null;
  onDiscover: () => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}

function EndpointForm({
  draft,
  setDraft,
  adapterOptions,
  tierOptions,
  authKindOptions,
  selectedAuthKindRequiresSecret,
  endpointIdLocked,
  discovering,
  discoveredModels,
  onDiscover,
  busy,
  onSubmit,
  onCancel,
  submitLabel,
}: FormProps) {
  return (
    <div className="nx-admin-endpoint-form">
      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Endpoint ID</span>
          <input
            className="nx-admin-endpoint-form__input"
            value={draft.endpointId}
            disabled={endpointIdLocked}
            placeholder="e.g. ollama-jameshp"
            onChange={e => setDraft(d => ({ ...d, endpointId: e.target.value }))}
          />
        </label>
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Tier</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.tier}
            onChange={e => setDraft(d => ({ ...d, tier: e.target.value }))}
          >
            <option value="" disabled>
              — select tier —
            </option>
            {tierOptions.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field nx-admin-endpoint-form__field--wide">
          <span className="nx-admin-endpoint-form__label">URL</span>
          <input
            className="nx-admin-endpoint-form__input"
            value={draft.url}
            placeholder="http://jameshp:11434/api/chat"
            onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
          />
        </label>
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Adapter</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={
              adapterOptions.includes(draft.adapterId) || draft.adapterId === ''
                ? draft.adapterId
                : '__custom__'
            }
            onChange={e => {
              if (e.target.value === '__custom__') {
                setDraft(d => ({ ...d, adapterId: '' }));
              } else {
                setDraft(d => ({ ...d, adapterId: e.target.value }));
              }
            }}
          >
            <option value="" disabled>
              — select adapter —
            </option>
            {adapterOptions.map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            <option value="__custom__">Add new…</option>
          </select>
          {!adapterOptions.includes(draft.adapterId) && draft.adapterId !== '' && (
            <input
              className="nx-admin-endpoint-form__input"
              placeholder="custom adapter id"
              value={draft.adapterId}
              onChange={e => setDraft(d => ({ ...d, adapterId: e.target.value }))}
            />
          )}
        </label>
      </div>

      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field nx-admin-endpoint-form__field--wide">
          <span className="nx-admin-endpoint-form__label">Model</span>
          <div className="nx-admin-endpoint-form__model-row">
            <input
              className="nx-admin-endpoint-form__input"
              value={draft.modelName}
              placeholder="llama3.2 / claude-sonnet-4 / gpt-4o"
              onChange={e => setDraft(d => ({ ...d, modelName: e.target.value }))}
            />
            <button
              type="button"
              className="nx-admin-btn nx-admin-btn--secondary"
              disabled={busy || discovering || !draft.url}
              onClick={onDiscover}
              title="Probe the URL's /api/tags endpoint (ollama-compatible) to list available models"
            >
              {discovering ? 'Probing…' : 'Discover models'}
            </button>
          </div>
          {discoveredModels && discoveredModels.length > 0 && (
            <select
              className="nx-admin-endpoint-form__input nx-admin-endpoint-form__input--discovered"
              value=""
              onChange={e => {
                if (e.target.value) setDraft(d => ({ ...d, modelName: e.target.value }));
              }}
            >
              <option value="">— pick a discovered model —</option>
              {discoveredModels.map(m => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          {discoveredModels && discoveredModels.length === 0 && (
            <span className="nx-admin-endpoint-form__hint">
              Probe succeeded but no models reported.
            </span>
          )}
        </label>
      </div>

      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Auth kind</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.authKind}
            onChange={e => setDraft(d => ({ ...d, authKind: e.target.value }))}
          >
            {authKindOptions.map(a => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {selectedAuthKindRequiresSecret && (
          <>
            <label className="nx-admin-endpoint-form__field">
              <span className="nx-admin-endpoint-form__label">Secret ref</span>
              <input
                className="nx-admin-endpoint-form__input"
                placeholder="env:OPENAI_API_KEY"
                value={draft.authSecretRef}
                onChange={e => setDraft(d => ({ ...d, authSecretRef: e.target.value }))}
              />
            </label>
            <label className="nx-admin-endpoint-form__field">
              <span className="nx-admin-endpoint-form__label">Header name</span>
              <input
                className="nx-admin-endpoint-form__input"
                placeholder={draft.authKind === 'bearer' ? 'Authorization' : 'x-api-key'}
                value={draft.authHeaderName}
                onChange={e => setDraft(d => ({ ...d, authHeaderName: e.target.value }))}
              />
            </label>
            {draft.authKind === 'bearer' && (
              <label className="nx-admin-endpoint-form__field">
                <span className="nx-admin-endpoint-form__label">Prefix</span>
                <input
                  className="nx-admin-endpoint-form__input"
                  placeholder="Bearer "
                  value={draft.authPrefix}
                  onChange={e => setDraft(d => ({ ...d, authPrefix: e.target.value }))}
                />
              </label>
            )}
          </>
        )}
      </div>

      <div className="nx-admin-endpoint-form__actions">
        <button
          type="button"
          className="nx-admin-btn nx-admin-btn--primary"
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          className="nx-admin-btn nx-admin-btn--secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EndpointReadOnly({ entry }: { entry: EndpointEntry }) {
  const auth = (entry.auth as Record<string, unknown>) ?? {};
  return (
    <dl className="nx-admin-endpoint-readonly">
      <Row label="URL" value={entry.url} mono />
      <Row label="Adapter" value={entry.adapterId} mono />
      <Row label="Model" value={entry.modelName} mono />
      <Row label="Tier" value={entry.tier} />
      <Row label="Auth kind" value={String(auth['kind'] ?? 'none')} />
      {auth['secretRef'] !== undefined && (
        <Row label="Secret ref" value={String(auth['secretRef'])} mono />
      )}
      {auth['headerName'] !== undefined && (
        <Row label="Header name" value={String(auth['headerName'])} mono />
      )}
    </dl>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="nx-admin-endpoint-readonly__row">
      <dt className="nx-admin-endpoint-readonly__label">{label}</dt>
      <dd
        className={
          mono
            ? 'nx-admin-endpoint-readonly__value nx-admin-endpoint-readonly__value--mono'
            : 'nx-admin-endpoint-readonly__value'
        }
      >
        {value || '—'}
      </dd>
    </div>
  );
}
