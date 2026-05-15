// packages/workspace-ref/src/client/components/admin/panels/workspace-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.4 — writer-enabled workspace
// CRUD. entryMode is locked to 'governed_only' server-side via z.literal +
// explicit guard; the form renders it read-only with a tooltip.
//
// returnEndpointId is a dropdown driven by the catalog's allReturnEndpoints
// (cross-surface validation: only currently-defined return endpoints are
// selectable). Per §8 best-solve decision: cardinality is N:1 — multiple
// workspaces may share one return endpoint.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { WORKSPACE_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import type { AdminCatalog } from '../../../admin-catalog-api.js';
import { addWorkspace, removeWorkspace, updateWorkspace } from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  catalog?: AdminCatalog;
  onCatalogReload?: () => void;
}

interface WorkspaceEntry extends Record<string, unknown> {
  workspaceSocketId: string;
  workspaceType: string;
  enabled: boolean;
  entryMode: string;
  baseUrl: string;
  returnEndpointId: string;
  capabilities: {
    promptEntry: boolean;
    planReview: boolean;
    finalDisplay: boolean;
    fileSpace: boolean;
  };
}

const COLUMNS: readonly ManifestTableColumn<WorkspaceEntry>[] = [
  { key: 'workspaceSocketId', label: 'socketId' },
  { key: 'workspaceType', label: 'type' },
  { key: 'entryMode', label: 'entryMode' },
  { key: 'baseUrl', label: 'baseUrl' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];

const WORKSPACE_TYPES = ['reference_http', 'http', 'cli', 'mcp', 'other'] as const;

interface WorkspaceAddDraft {
  workspaceSocketId: string;
  workspaceType: string;
  baseUrl: string;
  returnEndpointId: string;
  capPromptEntry: boolean;
  capPlanReview: boolean;
  capFinalDisplay: boolean;
  capFileSpace: boolean;
}

function defaultDraft(): WorkspaceAddDraft {
  return {
    workspaceSocketId: '',
    workspaceType: 'reference_http',
    baseUrl: 'http://localhost:4100',
    returnEndpointId: '',
    capPromptEntry: true,
    capPlanReview: true,
    capFinalDisplay: true,
    capFileSpace: false,
  };
}

export function WorkspaceSetupPanel({ data, elevatedSessionId, catalog, onCatalogReload }: Props) {
  const surface = data ?? WORKSPACE_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as WorkspaceEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.workspaceSocketId);
  const selected = entries.find(e => e.workspaceSocketId === selectedId) ?? null;

  const returnEndpointOptions = (
    (catalog?.allReturnEndpoints ?? []) as Array<Record<string, unknown>>
  )
    .map(e => ({
      id: String(e['returnEndpointId'] ?? ''),
      enabled: e['enabled'] !== false,
    }))
    .filter(e => e.id.length > 0 && e.enabled);

  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<WorkspaceAddDraft>(() => ({
    ...defaultDraft(),
    returnEndpointId: returnEndpointOptions[0]?.id ?? '',
  }));
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  async function handleAdd() {
    if (!elevatedSessionId || !draft.workspaceSocketId || !draft.returnEndpointId) return;
    setBusy(true);
    setFeedback(null);
    const res = await addWorkspace(elevatedSessionId, {
      workspaceSocketId: draft.workspaceSocketId,
      workspaceType: draft.workspaceType,
      enabled: true,
      entryMode: 'governed_only',
      baseUrl: draft.baseUrl,
      returnEndpointId: draft.returnEndpointId,
      capabilities: {
        promptEntry: draft.capPromptEntry,
        planReview: draft.capPlanReview,
        finalDisplay: draft.capFinalDisplay,
        fileSpace: draft.capFileSpace,
      },
      configuration: {},
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Workspace ${draft.workspaceSocketId} added. Restart server to apply.`,
      });
      setShowAddForm(false);
      setDraft({ ...defaultDraft(), returnEndpointId: returnEndpointOptions[0]?.id ?? '' });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add workspace' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeWorkspace(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Workspace ${selectedId} removed. Restart required.`,
      });
      setSelectedId(undefined);
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove workspace' });
    }
  }

  async function handleToggleEnabled(target: WorkspaceEntry, nextEnabled: boolean) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateWorkspace(elevatedSessionId, target.workspaceSocketId, {
      enabled: nextEnabled,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Workspace ${target.workspaceSocketId} ${nextEnabled ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update workspace' });
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
        <AdminManifestTable<WorkspaceEntry>
          rows={entries}
          idKey="workspaceSocketId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Workspace — ${selected.workspaceSocketId}` : undefined}
          secretFields={surface.secretFields}
          {...(canWrite
            ? {}
            : { disabledReason: 'Writer not available — elevated session required' })}
        />
        {selected ? (
          <p className="nx-admin-panel__hint">
            <strong>entryMode</strong> is locked to <code>governed_only</code> in this version — see
            AMEND-nexus-admin-dashboard-full-buildout §3.4.
          </p>
        ) : null}
      </div>
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + Add workspace
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(selected, !selected.enabled)}
                >
                  {selected.enabled ? 'Disable' : 'Enable'} workspace
                </button>
                <button type="button" disabled={busy} onClick={handleDelete}>
                  Delete selected
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add workspace
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add workspace</h4>
          <label>
            Socket ID:{' '}
            <input
              value={draft.workspaceSocketId}
              onChange={e => setDraft(d => ({ ...d, workspaceSocketId: e.target.value }))}
              placeholder="e.g. http-2"
            />
          </label>
          <label>
            Workspace type:{' '}
            <select
              value={draft.workspaceType}
              onChange={e => setDraft(d => ({ ...d, workspaceType: e.target.value }))}
            >
              {WORKSPACE_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Entry mode:{' '}
            <input
              value="governed_only"
              readOnly
              title="Locked to governed_only — AMEND-nexus-admin-dashboard §3.4"
            />
          </label>
          <label>
            Base URL:{' '}
            <input
              value={draft.baseUrl}
              onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
              placeholder="http://localhost:4100"
            />
          </label>
          <label>
            Return endpoint:{' '}
            <select
              value={draft.returnEndpointId}
              onChange={e => setDraft(d => ({ ...d, returnEndpointId: e.target.value }))}
            >
              <option value="">— select an enabled return endpoint —</option>
              {returnEndpointOptions.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.id}
                </option>
              ))}
            </select>
          </label>
          {returnEndpointOptions.length === 0 && (
            <p className="nx-admin-panel__hint">
              No enabled return endpoints found. Create one under
              <em>Mailbox / Compile / Return → Return endpoints</em> first.
            </p>
          )}
          <fieldset>
            <legend>Capabilities</legend>
            <label>
              <input
                type="checkbox"
                checked={draft.capPromptEntry}
                onChange={e => setDraft(d => ({ ...d, capPromptEntry: e.target.checked }))}
              />{' '}
              promptEntry
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capPlanReview}
                onChange={e => setDraft(d => ({ ...d, capPlanReview: e.target.checked }))}
              />{' '}
              planReview
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capFinalDisplay}
                onChange={e => setDraft(d => ({ ...d, capFinalDisplay: e.target.checked }))}
              />{' '}
              finalDisplay
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capFileSpace}
                onChange={e => setDraft(d => ({ ...d, capFileSpace: e.target.checked }))}
              />{' '}
              fileSpace
            </label>
          </fieldset>
          <div>
            <button
              type="button"
              disabled={busy || !draft.workspaceSocketId || !draft.returnEndpointId}
              onClick={handleAdd}
            >
              {busy ? 'Saving…' : 'Save workspace'}
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
