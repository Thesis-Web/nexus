// packages/workspace-ref/src/client/components/admin/panels/actor-agent-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Actors & agents surface.
// SPEC-ADMIN-WRITER §5 — Writer-enabled CRUD against ActorRegistry (SQLite).
// SPEC-AGENT-PANEL-CATALOG — catalog-driven dropdowns, inline edit, enable/disable.
//
// Mutations are immediate (no restart): the registry is SQLite, and the
// workspace agent dropdown reads through the same registry on every request.

import { useEffect, useMemo, useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { ACTORS_AGENTS_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import { addActor, deleteActor, updateActor } from '../../../admin-writer-api.js';
import type { AdminCatalog, AdminCatalogActorEntry } from '../../../admin-catalog-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  /**
   * principalId of the admin operating the dashboard. Used to auto-populate
   * the "Registered by" field on new agent records — see PATCH-AGENT-PANEL
   * Section 3 (registrar audit trail; not the runtime delegation authority).
   */
  adminPrincipalId?: string;
  catalog?: AdminCatalog;
  onCatalogReload: () => void;
}

const COLUMNS: readonly ManifestTableColumn<AdminCatalogActorEntry>[] = [
  { key: 'displayName', label: 'displayName' },
  { key: 'actorClass', label: 'class' },
  {
    key: 'principalId',
    label: 'registered by',
    render: v => (typeof v === 'string' ? v.slice(0, 8) + '…' : '—'),
  },
  { key: 'octLevel', label: 'OCT' },
  { key: 'riskCeiling', label: 'risk' },
  {
    key: 'allowedCapabilities',
    label: 'caps',
    render: v => (Array.isArray(v) ? `${v.length}` : '—'),
  },
];

const ENVIRONMENTS: readonly string[] = ['reference', 'dev', 'staging', 'production'];

interface DraftActor {
  displayName: string;
  actorClass: string;
  principalId: string;
  environment: string;
  octLevel: string;
  riskCeiling: string;
  allowedSystems: string[];
  allowedCapabilities: string[];
  owner: string;
  purpose: string;
  reviewCadence: string;
}

function emptyDraft(_catalog: AdminCatalog | undefined, adminPrincipalId: string): DraftActor {
  return {
    displayName: '',
    actorClass: 'SUPERVISED_AGENT',
    // Auto-populated registrar (audit trail). Read-only in the form —
    // see PATCH-AGENT-PANEL Section 3.
    principalId: adminPrincipalId,
    environment: 'reference',
    octLevel: 'OCT-OPEN',
    riskCeiling: 'medium',
    allowedSystems: [],
    allowedCapabilities: [],
    owner: '',
    purpose: '',
    reviewCadence: 'quarterly',
  };
}

function entryToDraft(entry: AdminCatalogActorEntry): DraftActor {
  return {
    displayName: entry.displayName ?? '',
    actorClass: entry.actorClass,
    principalId: entry.principalId,
    environment: entry.environment,
    octLevel: entry.octLevel ?? 'OCT-OPEN',
    riskCeiling: entry.riskCeiling,
    allowedSystems: [...(entry.allowedSystems ?? [])],
    allowedCapabilities: [...(entry.allowedCapabilities ?? [])],
    owner: entry.owner ?? '',
    purpose: entry.purpose ?? '',
    reviewCadence: entry.reviewCadence ?? 'quarterly',
  };
}

interface Feedback {
  type: 'success' | 'error' | 'info';
  msg: string;
}

const REVIEW_CADENCES: readonly string[] = ['quarterly', 'annual', 'monthly', 'on-change'];
const NON_HUMAN_CLASSES: readonly string[] = [
  'SUPERVISED_AGENT',
  'AUTONOMOUS_AGENT',
  'SCHEDULED_AGENT',
  'DELEGATED_SUBAGENT',
  'SERVICE_AUTOMATION',
  'HUMAN_WITH_COPILOT',
];

export function ActorAgentSetupPanel({
  data,
  elevatedSessionId,
  adminPrincipalId,
  catalog,
  onCatalogReload,
}: Props) {
  const surface = data ?? ACTORS_AGENTS_PLACEHOLDER;
  const canWrite = !!elevatedSessionId;
  const registrarPrincipalId = adminPrincipalId ?? '';

  const entries: readonly AdminCatalogActorEntry[] = useMemo(() => {
    if (catalog?.allActors) return catalog.allActors;
    // Fallback to projection-supplied entries when catalog hasn't loaded yet —
    // the projection's actor entries are shaped the same as catalog actors.
    return (surface.currentConfiguredValue['entries'] as AdminCatalogActorEntry[]) ?? [];
  }, [catalog, surface]);

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (selectedId && !entries.some(e => e.actorId === selectedId)) {
      setSelectedId(undefined);
    }
  }, [entries, selectedId]);
  const selected = entries.find(e => e.actorId === selectedId) ?? null;

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Add form state ─────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<DraftActor>(() =>
    emptyDraft(catalog, registrarPrincipalId)
  );

  // Keep the auto-populated registrar in sync if the admin's principalId
  // resolves later (e.g. on first /me hydration). We only touch it when the
  // admin hasn't started typing (form is closed), which is the only state
  // where overwriting is safe.
  useEffect(() => {
    if (!showAddForm) {
      setAddDraft(d => ({ ...d, principalId: registrarPrincipalId }));
    }
  }, [registrarPrincipalId, showAddForm]);

  // ── Edit form state ────────────────────────────────────────────────────
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftActor>(() =>
    emptyDraft(catalog, registrarPrincipalId)
  );
  useEffect(() => {
    if (editing && editing !== selectedId) setEditing(null);
  }, [selectedId, editing]);

  // Catalog-driven option lists (with safe fallbacks).
  const actorClassOptions = catalog?.actorClasses ?? [
    { id: 'SUPERVISED_AGENT', label: 'SUPERVISED_AGENT' },
    { id: 'HUMAN', label: 'HUMAN' },
  ];
  const octOptions = catalog?.octLevels ?? [];
  const riskOptions = useMemo(() => {
    const list = catalog?.riskTiers ?? [];
    return [...list].sort((a, b) => a.order - b.order);
  }, [catalog]);
  const capabilityOptions = catalog?.capabilityIds ?? [];
  const systemOptions = useMemo(() => {
    const fromConnectors = (catalog?.allConnectors ?? [])
      .map(c => (typeof c['connectorId'] === 'string' ? c['connectorId'] : ''))
      .filter(Boolean);
    return Array.from(new Set(['*', 'stub', ...fromConnectors]));
  }, [catalog]);

  // ── Mutation handlers ──────────────────────────────────────────────────
  function validate(draft: DraftActor): string | null {
    if (!draft.displayName.trim()) return 'displayName is required.';
    if (!draft.actorClass) return 'actorClass is required.';
    // principalId is auto-populated from the admin's elevated session
    // (registrar audit trail). If it's missing, the admin identity hasn't
    // hydrated yet — surface a clear error rather than POSTing a blank UUID.
    if (!draft.principalId.trim())
      return 'Registered-by principalId is missing — admin identity not yet loaded.';
    if (!draft.environment) return 'environment is required.';
    if (!draft.octLevel) return 'octLevel is required.';
    if (!draft.riskCeiling) return 'riskCeiling is required.';
    if (draft.allowedSystems.length === 0) return 'allowedSystems must include at least one entry.';
    if (NON_HUMAN_CLASSES.includes(draft.actorClass)) {
      if (!draft.owner.trim()) return 'owner is required for non-human actors.';
      if (!draft.purpose.trim()) return 'purpose is required for non-human actors.';
      if (!draft.reviewCadence.trim()) return 'reviewCadence is required for non-human actors.';
    }
    return null;
  }

  async function handleAdd() {
    if (!elevatedSessionId) return;
    const err = validate(addDraft);
    if (err) {
      setFeedback({ type: 'error', msg: err });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const actorId = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      actorId,
      actorClass: addDraft.actorClass,
      principalId: addDraft.principalId.trim(),
      displayName: addDraft.displayName.trim(),
      environment: addDraft.environment,
      octLevel: addDraft.octLevel,
      riskCeiling: addDraft.riskCeiling,
      allowedSystems: addDraft.allowedSystems,
      allowedCapabilities: addDraft.allowedCapabilities,
      enabled: true,
      registeredAt: new Date().toISOString(),
    };
    if (NON_HUMAN_CLASSES.includes(addDraft.actorClass)) {
      payload['owner'] = addDraft.owner.trim();
      payload['purpose'] = addDraft.purpose.trim();
      payload['reviewCadence'] = addDraft.reviewCadence.trim();
    }
    const res = await addActor(elevatedSessionId, payload);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Agent "${addDraft.displayName}" registered. Available immediately.`,
      });
      setShowAddForm(false);
      setAddDraft(emptyDraft(catalog, registrarPrincipalId));
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to register actor' });
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditing(selected.actorId);
    setEditDraft(entryToDraft(selected));
  }

  function cancelEdit() {
    setEditing(null);
    setEditDraft(emptyDraft(catalog, registrarPrincipalId));
  }

  async function handleEditSave() {
    if (!elevatedSessionId || !editing) return;
    const err = validate(editDraft);
    if (err) {
      setFeedback({ type: 'error', msg: err });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const payload: Record<string, unknown> = {
      actorClass: editDraft.actorClass,
      principalId: editDraft.principalId.trim(),
      displayName: editDraft.displayName.trim(),
      environment: editDraft.environment,
      octLevel: editDraft.octLevel,
      riskCeiling: editDraft.riskCeiling,
      allowedSystems: editDraft.allowedSystems,
      allowedCapabilities: editDraft.allowedCapabilities,
    };
    if (NON_HUMAN_CLASSES.includes(editDraft.actorClass)) {
      payload['owner'] = editDraft.owner.trim();
      payload['purpose'] = editDraft.purpose.trim();
      payload['reviewCadence'] = editDraft.reviewCadence.trim();
    }
    const res = await updateActor(elevatedSessionId, editing, payload);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Agent "${editDraft.displayName}" updated.`,
      });
      setEditing(null);
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update actor' });
    }
  }

  async function handleToggleEnabled(entry: AdminCatalogActorEntry) {
    if (!elevatedSessionId) return;
    const next = entry.enabled === false;
    setBusy(true);
    setFeedback(null);
    const res = await updateActor(elevatedSessionId, entry.actorId, { enabled: next });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Agent "${entry.displayName}" ${next ? 'enabled' : 'disabled'}.`,
      });
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to toggle agent' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId || !selected) return;
    if (!window.confirm(`Delete agent "${selected.displayName}"? This cannot be undone.`)) return;
    setBusy(true);
    setFeedback(null);
    const res = await deleteActor(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Agent "${selected.displayName}" deleted.` });
      setSelectedId(undefined);
      setEditing(null);
      onCatalogReload();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to delete agent' });
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
        <strong>Note:</strong> Agent changes are persisted to SQLite (<code>ActorRegistry</code>)
        and take effect immediately — no restart required.
      </div>

      <div className="nx-admin-panel__table">
        <AdminManifestTable<AdminCatalogActorEntry>
          rows={entries}
          idKey="actorId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {selected && (
        <div className="nx-admin-endpoint-detail">
          <div className="nx-admin-endpoint-detail__header">
            <h3 className="nx-admin-endpoint-detail__title">
              {selected.displayName}
              <span
                className={`nx-admin-endpoint-detail__pill ${
                  selected.enabled !== false
                    ? 'nx-admin-endpoint-detail__pill--enabled'
                    : 'nx-admin-endpoint-detail__pill--disabled'
                }`}
              >
                {selected.enabled !== false ? 'enabled' : 'disabled'}
              </span>
            </h3>
            <div className="nx-admin-endpoint-detail__actions">
              {canWrite && editing !== selected.actorId && (
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
                    {selected.enabled !== false ? 'Disable' : 'Enable'}
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

          {editing === selected.actorId ? (
            <ActorForm
              draft={editDraft}
              setDraft={setEditDraft}
              actorClassOptions={actorClassOptions}
              octOptions={octOptions}
              riskOptions={riskOptions}
              capabilityOptions={capabilityOptions}
              systemOptions={systemOptions}
              busy={busy}
              onSubmit={handleEditSave}
              onCancel={cancelEdit}
              submitLabel="Save changes"
            />
          ) : (
            <ActorReadOnly entry={selected} />
          )}
        </div>
      )}

      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <button
            type="button"
            className="nx-admin-btn nx-admin-btn--primary"
            disabled={busy || !catalog}
            onClick={() => {
              setShowAddForm(s => !s);
              setAddDraft(emptyDraft(catalog, registrarPrincipalId));
            }}
          >
            {showAddForm ? 'Close add form' : '+ Add actor / agent'}
          </button>
        ) : (
          <button type="button" className="nx-admin-btn" disabled title="Elevated session required">
            + Add actor / agent
          </button>
        )}
      </div>

      {showAddForm && canWrite && (
        <div className="nx-admin-endpoint-form-card">
          <h4 className="nx-admin-endpoint-form-card__title">Register new actor / agent</h4>
          <ActorForm
            draft={addDraft}
            setDraft={setAddDraft}
            actorClassOptions={actorClassOptions}
            octOptions={octOptions}
            riskOptions={riskOptions}
            capabilityOptions={capabilityOptions}
            systemOptions={systemOptions}
            busy={busy}
            onSubmit={handleAdd}
            onCancel={() => {
              setShowAddForm(false);
              setAddDraft(emptyDraft(catalog, registrarPrincipalId));
            }}
            submitLabel="Register actor"
          />
        </div>
      )}
    </PanelChrome>
  );
}

// ─── Form subcomponent ─────────────────────────────────────────────────────

interface ActorFormProps {
  draft: DraftActor;
  setDraft: (updater: (prev: DraftActor) => DraftActor) => void;
  actorClassOptions: readonly { id: string; label: string }[];
  octOptions: readonly { id: string; label: string }[];
  riskOptions: readonly { id: string; label: string; order: number }[];
  capabilityOptions: readonly string[];
  systemOptions: readonly string[];
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}

function ActorForm({
  draft,
  setDraft,
  actorClassOptions,
  octOptions,
  riskOptions,
  capabilityOptions,
  systemOptions,
  busy,
  onSubmit,
  onCancel,
  submitLabel,
}: ActorFormProps) {
  const isNonHuman = NON_HUMAN_CLASSES.includes(draft.actorClass);

  function toggleArrayMember(arr: readonly string[], value: string): string[] {
    return arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];
  }

  return (
    <div className="nx-admin-endpoint-form">
      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Display name</span>
          <input
            className="nx-admin-endpoint-form__input"
            value={draft.displayName}
            placeholder="e.g. math-worker"
            onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))}
          />
        </label>
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Class</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.actorClass}
            onChange={e => setDraft(d => ({ ...d, actorClass: e.target.value }))}
          >
            {actorClassOptions.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field nx-admin-endpoint-form__field--wide">
          <span className="nx-admin-endpoint-form__label">Registered by</span>
          <input
            className="nx-admin-endpoint-form__input"
            value={draft.principalId}
            readOnly
            aria-readonly="true"
            title="Auto-populated from your elevated session — registrar audit trail. Not the runtime delegation authority."
          />
          <span className="nx-admin-endpoint-form__hint">
            Auto-set to the admin registering this record. Audit-trail only — at runtime, the agent
            operates under the requesting user&apos;s authority.
          </span>
        </label>
      </div>

      <div className="nx-admin-endpoint-form__row">
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Environment</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.environment}
            onChange={e => setDraft(d => ({ ...d, environment: e.target.value }))}
          >
            {ENVIRONMENTS.map(env => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">OCT level</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.octLevel}
            onChange={e => setDraft(d => ({ ...d, octLevel: e.target.value }))}
          >
            <option value="" disabled>
              — select OCT —
            </option>
            {octOptions.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-admin-endpoint-form__field">
          <span className="nx-admin-endpoint-form__label">Risk ceiling</span>
          <select
            className="nx-admin-endpoint-form__input"
            value={draft.riskCeiling}
            onChange={e => setDraft(d => ({ ...d, riskCeiling: e.target.value }))}
          >
            <option value="" disabled>
              — select risk —
            </option>
            {riskOptions.map(r => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="nx-admin-endpoint-form__multifield">
        <legend className="nx-admin-endpoint-form__legend">
          Allowed systems ({draft.allowedSystems.length} selected)
        </legend>
        <div className="nx-admin-endpoint-form__chips">
          {systemOptions.map(s => (
            <label key={s} className="nx-admin-endpoint-form__chip">
              <input
                type="checkbox"
                checked={draft.allowedSystems.includes(s)}
                onChange={() =>
                  setDraft(d => ({ ...d, allowedSystems: toggleArrayMember(d.allowedSystems, s) }))
                }
              />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="nx-admin-endpoint-form__multifield">
        <legend className="nx-admin-endpoint-form__legend">
          Allowed capabilities ({draft.allowedCapabilities.length} selected)
        </legend>
        <div className="nx-admin-endpoint-form__chips nx-admin-endpoint-form__chips--two-col">
          {capabilityOptions.map(c => (
            <label key={c} className="nx-admin-endpoint-form__chip">
              <input
                type="checkbox"
                checked={draft.allowedCapabilities.includes(c)}
                onChange={() =>
                  setDraft(d => ({
                    ...d,
                    allowedCapabilities: toggleArrayMember(d.allowedCapabilities, c),
                  }))
                }
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {isNonHuman && (
        <div className="nx-admin-endpoint-form__row">
          <label className="nx-admin-endpoint-form__field">
            <span className="nx-admin-endpoint-form__label">Owner</span>
            <input
              className="nx-admin-endpoint-form__input"
              value={draft.owner}
              placeholder="team or person responsible"
              onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}
            />
          </label>
          <label className="nx-admin-endpoint-form__field nx-admin-endpoint-form__field--wide">
            <span className="nx-admin-endpoint-form__label">Purpose</span>
            <input
              className="nx-admin-endpoint-form__input"
              value={draft.purpose}
              placeholder="what this agent is for"
              onChange={e => setDraft(d => ({ ...d, purpose: e.target.value }))}
            />
          </label>
          <label className="nx-admin-endpoint-form__field">
            <span className="nx-admin-endpoint-form__label">Review cadence</span>
            <select
              className="nx-admin-endpoint-form__input"
              value={draft.reviewCadence}
              onChange={e => setDraft(d => ({ ...d, reviewCadence: e.target.value }))}
            >
              {REVIEW_CADENCES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

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

function ActorReadOnly({ entry }: { entry: AdminCatalogActorEntry }) {
  return (
    <dl className="nx-admin-endpoint-readonly">
      <RoRow label="Display name" value={entry.displayName} />
      <RoRow label="Class" value={entry.actorClass} />
      <RoRow label="Registered by" value={entry.principalId} mono />
      <RoRow label="Environment" value={entry.environment} />
      <RoRow label="OCT level" value={entry.octLevel ?? '—'} />
      <RoRow label="Risk ceiling" value={entry.riskCeiling} />
      <RoRow
        label="Allowed systems"
        value={entry.allowedSystems.length > 0 ? entry.allowedSystems.join(', ') : '—'}
      />
      <RoRow
        label="Allowed capabilities"
        value={
          entry.allowedCapabilities && entry.allowedCapabilities.length > 0
            ? entry.allowedCapabilities.join(', ')
            : '—'
        }
        mono
      />
      {entry.owner && <RoRow label="Owner" value={entry.owner} />}
      {entry.purpose && <RoRow label="Purpose" value={entry.purpose} />}
      {entry.reviewCadence && <RoRow label="Review cadence" value={entry.reviewCadence} />}
      <RoRow label="Registered" value={entry.registeredAt} mono />
    </dl>
  );
}

function RoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
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
