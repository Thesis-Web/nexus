// packages/workspace-ref/src/client/components/admin/panels/actor-agent-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Actors & agents surface.
// SPEC-ADMIN-WRITER §5 — Writer-enabled (Claude D).
// Flagged HOLE-A02: Actor.roles?: NonEmpty[] missing from Layer-2 contract.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { ACTORS_AGENTS_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';
import { addActor, deleteActor } from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
}

interface ActorEntry extends Record<string, unknown> {
  actorId: string;
  actorClass: string;
  displayName: string;
  environment: string;
  octLevel: string;
  riskCeiling: string;
  allowedSystems: readonly string[];
  allowedCapabilities: readonly string[];
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<ActorEntry>[] = [
  { key: 'displayName', label: 'displayName' },
  { key: 'actorClass', label: 'class' },
  { key: 'octLevel', label: 'OCT' },
  { key: 'riskCeiling', label: 'risk' },
  {
    key: 'allowedCapabilities',
    label: 'caps',
    render: v => (Array.isArray(v) ? `${v.length} cap(s)` : '—'),
  },
];

export function ActorAgentSetupPanel({ data, elevatedSessionId }: Props) {
  const surface = data ?? ACTORS_AGENTS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ActorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.actorId);
  const selected = entries.find(e => e.actorId === selectedId) ?? null;

  // ── Writer state (Claude D) ───────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFields, setAddFields] = useState({
    displayName: '',
    actorClass: 'SUPERVISED_AGENT',
    octLevel: 'OCT-OPEN',
    riskCeiling: 'medium',
    allowedSystems: 'stub',
    allowedCapabilities: 'read:record:single',
    owner: '',
    purpose: '',
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  async function handleAdd() {
    if (!elevatedSessionId || !addFields.displayName || !addFields.owner || !addFields.purpose)
      return;
    setBusy(true);
    setFeedback(null);
    const actorId = crypto.randomUUID();
    const principalId = crypto.randomUUID();
    const res = await addActor(elevatedSessionId, {
      actorId,
      actorClass: addFields.actorClass,
      principalId,
      displayName: addFields.displayName,
      environment: 'reference',
      octLevel: addFields.octLevel,
      riskCeiling: addFields.riskCeiling,
      allowedSystems: addFields.allowedSystems.split(',').map(s => s.trim()),
      allowedCapabilities: addFields.allowedCapabilities.split(',').map(s => s.trim()),
      enabled: true,
      registeredAt: new Date().toISOString(),
      owner: addFields.owner,
      purpose: addFields.purpose,
      reviewCadence: 'quarterly',
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Actor ${addFields.displayName} registered. Available immediately.`,
      });
      setShowAddForm(false);
      setAddFields({
        displayName: '',
        actorClass: 'SUPERVISED_AGENT',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'medium',
        allowedSystems: 'stub',
        allowedCapabilities: 'read:record:single',
        owner: '',
        purpose: '',
      });
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to register actor' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await deleteActor(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Actor ${selectedId} deleted.` });
      setSelectedId(undefined);
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to delete actor' });
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
        <AdminManifestTable<ActorEntry>
          rows={entries}
          idKey="actorId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Actor — ${selected.displayName} (${selected.actorClass})` : undefined}
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
              + Add actor / agent
            </button>
            {selected && (
              <button type="button" disabled={busy} onClick={handleDelete}>
                Delete selected
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add user / agent / MCP wrapper
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Register new actor</h4>
          <label>
            Display name:{' '}
            <input
              value={addFields.displayName}
              onChange={e => setAddFields(f => ({ ...f, displayName: e.target.value }))}
            />
          </label>
          <label>
            Class:
            <select
              value={addFields.actorClass}
              onChange={e => setAddFields(f => ({ ...f, actorClass: e.target.value }))}
            >
              <option value="SUPERVISED_AGENT">SUPERVISED_AGENT</option>
              <option value="HUMAN">HUMAN</option>
              <option value="ORCHESTRATOR">ORCHESTRATOR</option>
              <option value="COMPILER">COMPILER</option>
            </select>
          </label>
          <label>
            OCT level:
            <select
              value={addFields.octLevel}
              onChange={e => setAddFields(f => ({ ...f, octLevel: e.target.value }))}
            >
              <option value="OCT-OPEN">OCT-OPEN</option>
              <option value="OCT-CONFIDENTIAL">OCT-CONFIDENTIAL</option>
              <option value="OCT-SECURE">OCT-SECURE</option>
            </select>
          </label>
          <label>
            Risk ceiling:
            <select
              value={addFields.riskCeiling}
              onChange={e => setAddFields(f => ({ ...f, riskCeiling: e.target.value }))}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </label>
          <label>
            Allowed systems (comma-sep):{' '}
            <input
              value={addFields.allowedSystems}
              onChange={e => setAddFields(f => ({ ...f, allowedSystems: e.target.value }))}
            />
          </label>
          <label>
            Capabilities (comma-sep):{' '}
            <input
              value={addFields.allowedCapabilities}
              onChange={e => setAddFields(f => ({ ...f, allowedCapabilities: e.target.value }))}
            />
          </label>
          <label>
            Owner:{' '}
            <input
              value={addFields.owner}
              onChange={e => setAddFields(f => ({ ...f, owner: e.target.value }))}
            />
          </label>
          <label>
            Purpose:{' '}
            <input
              value={addFields.purpose}
              onChange={e => setAddFields(f => ({ ...f, purpose: e.target.value }))}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !addFields.displayName || !addFields.owner || !addFields.purpose}
              onClick={handleAdd}
            >
              {busy ? 'Registering…' : 'Register actor'}
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
