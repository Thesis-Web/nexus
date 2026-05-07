// packages/workspace-ref/src/client/components/admin/panels/connector-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.2 — Connectors / target systems.
// SPEC-ADMIN-WRITER §6 — Writer-enabled (Claude D).
// WRITER-001: connector types additive, validated at manifest load time.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { CONNECTORS_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';
import { addConnector, removeConnector } from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
}

interface ConnectorEntry extends Record<string, unknown> {
  connectorId: string;
  connectorType: string;
  allowedSystems: readonly string[];
  configuration: Record<string, unknown>;
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<ConnectorEntry>[] = [
  { key: 'connectorId', label: 'connectorId' },
  { key: 'connectorType', label: 'kind' },
  {
    key: 'allowedSystems',
    label: 'allowedSystems',
    render: v => (Array.isArray(v) ? v.join(', ') : '—'),
  },
];

export function ConnectorSetupPanel({ data, elevatedSessionId }: Props) {
  const surface = data ?? CONNECTORS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ConnectorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.connectorId);
  const selected = entries.find(e => e.connectorId === selectedId) ?? null;

  // ── Writer state (Claude D) ───────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFields, setAddFields] = useState({
    connectorId: '',
    connectorType: 'stub',
    allowedSystems: '*',
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  async function handleAdd() {
    if (!elevatedSessionId || !addFields.connectorId || !addFields.connectorType) return;
    setBusy(true);
    setFeedback(null);
    const res = await addConnector(elevatedSessionId, {
      connectorId: addFields.connectorId,
      connectorType: addFields.connectorType,
      allowedSystems: addFields.allowedSystems.split(',').map(s => s.trim()),
      configuration: {},
      enabled: true,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Connector ${addFields.connectorId} added. Restart required.`,
      });
      setShowAddForm(false);
      setAddFields({ connectorId: '', connectorType: 'stub', allowedSystems: '*' });
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add connector' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeConnector(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Connector ${selectedId} removed. Restart required.` });
      setSelectedId(undefined);
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove connector' });
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
        <AdminManifestTable<ConnectorEntry>
          rows={entries}
          idKey="connectorId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={
            selected ? `Connector — ${selected.connectorId} (${selected.connectorType})` : undefined
          }
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
              + Add connector
            </button>
            {selected && (
              <button type="button" disabled={busy} onClick={handleDelete}>
                Delete selected
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add connector
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add new connector</h4>
          <label>
            Connector ID:{' '}
            <input
              value={addFields.connectorId}
              onChange={e => setAddFields(f => ({ ...f, connectorId: e.target.value }))}
            />
          </label>
          <label>
            Connector type:{' '}
            <input
              value={addFields.connectorType}
              onChange={e => setAddFields(f => ({ ...f, connectorType: e.target.value }))}
            />
          </label>
          <label>
            Allowed systems (comma-sep):{' '}
            <input
              value={addFields.allowedSystems}
              onChange={e => setAddFields(f => ({ ...f, allowedSystems: e.target.value }))}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !addFields.connectorId || !addFields.connectorType}
              onClick={handleAdd}
            >
              {busy ? 'Saving…' : 'Save connector'}
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
