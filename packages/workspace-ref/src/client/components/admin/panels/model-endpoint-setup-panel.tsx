// packages/workspace-ref/src/client/components/admin/panels/model-endpoint-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.3 — Model endpoint / NVG surface.
// SPEC-ADMIN-WRITER §4 — Writer-enabled (Claude D).
// OR-DASH-009: secret presence only.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { MODELS_NVG_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';
import { addEndpoint, removeEndpoint } from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
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

export function ModelEndpointSetupPanel({ data, elevatedSessionId }: Props) {
  const surface = data ?? MODELS_NVG_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as EndpointEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.endpointId);
  const selected = entries.find(e => e.endpointId === selectedId) ?? null;

  // ── Writer state (Claude D) ───────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFields, setAddFields] = useState({
    endpointId: '',
    url: '',
    adapterId: 'ollama-chat-v1',
    modelName: '',
    tier: 'on_prem_general',
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  async function handleAdd() {
    if (!elevatedSessionId || !addFields.endpointId || !addFields.url || !addFields.modelName)
      return;
    setBusy(true);
    setFeedback(null);
    const res = await addEndpoint(elevatedSessionId, {
      endpointId: addFields.endpointId,
      url: addFields.url,
      adapterId: addFields.adapterId,
      modelName: addFields.modelName,
      tier: addFields.tier,
      enabled: true,
      auth: { kind: 'none' },
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Endpoint ${addFields.endpointId} added. Restart required.`,
      });
      setShowAddForm(false);
      setAddFields({
        endpointId: '',
        url: '',
        adapterId: 'ollama-chat-v1',
        modelName: '',
        tier: 'on_prem_general',
      });
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add endpoint' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeEndpoint(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Endpoint ${selectedId} removed. Restart required.` });
      setSelectedId(undefined);
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove endpoint' });
    }
  }

  const selectedSecrets = selected
    ? surface.secretFields.filter(sf => sf.fieldPath.includes(`[${selected.endpointId}]`))
    : surface.secretFields;

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}
      <div className="nx-admin-panel__table">
        <AdminManifestTable<EndpointEntry>
          rows={entries}
          idKey="endpointId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Endpoint — ${selected.endpointId} (${selected.tier})` : undefined}
          secretFields={selectedSecrets}
          {...(canWrite
            ? {}
            : { disabledReason: 'Writer not available — elevated session required' })}
        />
      </div>
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + Add endpoint
            </button>
            {selected && (
              <button type="button" disabled={busy} onClick={handleDelete}>
                Delete selected
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add endpoint
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add new endpoint</h4>
          <label>
            Endpoint ID:{' '}
            <input
              value={addFields.endpointId}
              onChange={e => setAddFields(f => ({ ...f, endpointId: e.target.value }))}
            />
          </label>
          <label>
            URL:{' '}
            <input
              value={addFields.url}
              onChange={e => setAddFields(f => ({ ...f, url: e.target.value }))}
            />
          </label>
          <label>
            Model name:{' '}
            <input
              value={addFields.modelName}
              onChange={e => setAddFields(f => ({ ...f, modelName: e.target.value }))}
            />
          </label>
          <label>
            Adapter:
            <select
              value={addFields.adapterId}
              onChange={e => setAddFields(f => ({ ...f, adapterId: e.target.value }))}
            >
              <option value="ollama-chat-v1">ollama-chat-v1</option>
              <option value="openai-chat-v1">openai-chat-v1</option>
              <option value="anthropic-messages-v1">anthropic-messages-v1</option>
            </select>
          </label>
          <label>
            Tier:
            <select
              value={addFields.tier}
              onChange={e => setAddFields(f => ({ ...f, tier: e.target.value }))}
            >
              <option value="on_prem_general">on_prem_general</option>
              <option value="on_prem_sensitive">on_prem_sensitive</option>
              <option value="frontier_general">frontier_general</option>
              <option value="frontier_sensitive">frontier_sensitive</option>
              <option value="air_gapped">air_gapped</option>
              <option value="managed_cloud">managed_cloud</option>
            </select>
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !addFields.endpointId || !addFields.url || !addFields.modelName}
              onClick={handleAdd}
            >
              {busy ? 'Saving…' : 'Save endpoint'}
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
