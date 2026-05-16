// packages/workspace-ref/src/client/components/admin/panels/workspace-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.4 — writer-enabled workspace
// CRUD.
// AMEND-nexus-planner-chat-tier-v0-2-0.md §3.7 — entryMode widens from
// locked literal to 'governed_only' | 'free_chat' dropdown. When operator
// selects free_chat, capability checkboxes lock to the chat-required shape
// (planReview=false, promptEntry=true, fileSpace=false, finalDisplay=true)
// and a defaultChatAgentId picker appears, filtered to actors whose
// allowedCapabilities include 'synthesize:content'.
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

const SYNTHESIZE_CAPABILITY = 'synthesize:content';
type EntryMode = 'governed_only' | 'free_chat';

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

const WORKSPACE_TYPES = [
  'reference_http',
  'http',
  'cli',
  'mcp',
  'chat_workspace',
  'other',
] as const;

interface WorkspaceAddDraft {
  workspaceSocketId: string;
  workspaceType: string;
  entryMode: EntryMode;
  baseUrl: string;
  returnEndpointId: string;
  capPromptEntry: boolean;
  capPlanReview: boolean;
  capFinalDisplay: boolean;
  capFileSpace: boolean;
  defaultChatAgentId: string;
}

function defaultDraft(): WorkspaceAddDraft {
  return {
    workspaceSocketId: '',
    workspaceType: 'reference_http',
    entryMode: 'governed_only',
    baseUrl: 'http://localhost:4100',
    returnEndpointId: '',
    capPromptEntry: true,
    capPlanReview: true,
    capFinalDisplay: true,
    capFileSpace: false,
    defaultChatAgentId: '',
  };
}

// When entryMode flips to free_chat, lock the capability shape per the
// loader + writer cross-field rules. Returning a fresh draft means the
// inputs below render as disabled checkboxes with the locked values.
function applyChatLock(draft: WorkspaceAddDraft, mode: EntryMode): WorkspaceAddDraft {
  if (mode === 'free_chat') {
    return {
      ...draft,
      entryMode: 'free_chat',
      workspaceType:
        draft.workspaceType === 'reference_http' ? 'chat_workspace' : draft.workspaceType,
      capPromptEntry: true,
      capPlanReview: false,
      capFinalDisplay: true,
      capFileSpace: false,
    };
  }
  return { ...draft, entryMode: 'governed_only' };
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
    if (draft.entryMode === 'free_chat' && !draft.defaultChatAgentId) {
      setFeedback({
        type: 'error',
        msg: 'free_chat workspace requires a default chat agent — select one above.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const configuration: Record<string, unknown> =
      draft.entryMode === 'free_chat' ? { defaultChatAgentId: draft.defaultChatAgentId } : {};
    const res = await addWorkspace(elevatedSessionId, {
      workspaceSocketId: draft.workspaceSocketId,
      workspaceType: draft.workspaceType,
      enabled: true,
      entryMode: draft.entryMode,
      baseUrl: draft.baseUrl,
      returnEndpointId: draft.returnEndpointId,
      capabilities: {
        promptEntry: draft.capPromptEntry,
        planReview: draft.capPlanReview,
        finalDisplay: draft.capFinalDisplay,
        fileSpace: draft.capFileSpace,
      },
      configuration,
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
        />
        {selected ? (
          <p className="nx-admin-panel__hint">
            <strong>entryMode</strong> selects the run shape. <code>governed_only</code> runs go
            through lexicon planning (Branches 1–4); <code>free_chat</code> runs go to a single chat
            agent (Branch 0). See AMEND-nexus-planner-chat-tier-v0-2-0.md §3.7.
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
            <select
              value={draft.entryMode}
              onChange={e => setDraft(d => applyChatLock(d, e.target.value as EntryMode))}
            >
              <option value="governed_only">governed_only</option>
              <option value="free_chat">free_chat</option>
            </select>
          </label>
          {draft.entryMode === 'free_chat' && (
            <label>
              Default chat agent:{' '}
              <select
                value={draft.defaultChatAgentId}
                onChange={e => setDraft(d => ({ ...d, defaultChatAgentId: e.target.value }))}
              >
                <option value="">— select a synthesize-capable actor —</option>
                {(catalog?.allActors ?? [])
                  .filter(a => a.allowedCapabilities?.includes(SYNTHESIZE_CAPABILITY) === true)
                  .map(a => ({
                    id: a.actorId,
                    label: a.displayName.length > 0 ? a.displayName : a.actorId,
                  }))
                  .filter(o => o.id.length > 0)
                  .map(opt => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
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
            <legend>
              Capabilities
              {draft.entryMode === 'free_chat' && (
                <span className="nx-admin-panel__hint"> (locked for free_chat)</span>
              )}
            </legend>
            <label>
              <input
                type="checkbox"
                checked={draft.capPromptEntry}
                disabled={draft.entryMode === 'free_chat'}
                onChange={e => setDraft(d => ({ ...d, capPromptEntry: e.target.checked }))}
              />{' '}
              promptEntry
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capPlanReview}
                disabled={draft.entryMode === 'free_chat'}
                onChange={e => setDraft(d => ({ ...d, capPlanReview: e.target.checked }))}
              />{' '}
              planReview
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capFinalDisplay}
                disabled={draft.entryMode === 'free_chat'}
                onChange={e => setDraft(d => ({ ...d, capFinalDisplay: e.target.checked }))}
              />{' '}
              finalDisplay
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.capFileSpace}
                disabled={draft.entryMode === 'free_chat'}
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
