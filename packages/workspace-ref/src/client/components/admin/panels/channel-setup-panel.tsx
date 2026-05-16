// packages/workspace-ref/src/client/components/admin/panels/channel-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.2 — writer-enabled approval
// channel CRUD. Pattern mirrors connector-setup-panel + identity-provider-
// setup-panel.
//
// Channel type discriminators (cli / webhook / slack / dashboard) drive the
// add-form UX. channelType is an open string at the wire level so factory-
// registered channels outside the spec's enum remain editable.
//
// Note on `dashboard` channel: per §3.2, this spec ships the channel record
// only; the in-browser approval UX lives in a separate spec. Adding a
// dashboard channel here is forward-compatible.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { CHANNELS_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  addApprovalChannel,
  removeApprovalChannel,
  updateApprovalChannel,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  onCatalogReload?: () => void;
}

interface ChannelEntry extends Record<string, unknown> {
  channelId: string;
  channelType: string;
  configuration: Record<string, unknown>;
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<ChannelEntry>[] = [
  { key: 'channelId', label: 'channelId' },
  { key: 'channelType', label: 'kind' },
  {
    key: 'enabled',
    label: 'status',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];

type DiscriminatorType = 'cli' | 'webhook' | 'slack' | 'dashboard' | 'other';

const TYPE_LABEL: Record<DiscriminatorType, string> = {
  cli: 'cli (terminal approvals)',
  webhook: 'webhook (HTTP POST)',
  slack: 'slack (channel bot)',
  dashboard: 'dashboard (in-browser; channel record only — UX in follow-on spec)',
  other: 'other (advanced — raw configuration)',
};

function defaultConfigFor(type: DiscriminatorType): Record<string, unknown> {
  switch (type) {
    case 'cli':
      return { promptText: 'Approval required. Run `nexus approve <id>` or `nexus deny <id>`.' };
    case 'webhook':
      return {
        url: '',
        signingSecretRef: 'file:APPROVAL_WEBHOOK_SECRET',
        timeoutMs: 5000,
      };
    case 'slack':
      return {
        workspaceUrl: '',
        channel: '#approvals',
        botTokenRef: 'file:SLACK_BOT_TOKEN',
      };
    case 'dashboard':
      return { sessionGate: 'elevated', defaultTtlSeconds: 600 };
    case 'other':
      return {};
  }
}

export function ChannelSetupPanel({ data, elevatedSessionId, onCatalogReload }: Props) {
  const surface = data ?? CHANNELS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ChannelEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.channelId);
  const selected = entries.find(e => e.channelId === selectedId) ?? null;

  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState<DiscriminatorType>('cli');
  const [addChannelId, setAddChannelId] = useState('');
  const [addConfigJson, setAddConfigJson] = useState(
    JSON.stringify(defaultConfigFor('cli'), null, 2)
  );
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  const isCliChannel =
    selected !== null && (selected.channelType === 'cli' || selected.channelId === 'cli');
  const isDashboardChannel = selected !== null && selected.channelType === 'dashboard';

  function selectType(type: DiscriminatorType) {
    setAddType(type);
    setAddConfigJson(JSON.stringify(defaultConfigFor(type), null, 2));
  }

  async function handleAdd() {
    if (!elevatedSessionId || !addChannelId) return;
    let configuration: Record<string, unknown>;
    try {
      configuration = JSON.parse(addConfigJson) as Record<string, unknown>;
    } catch {
      setFeedback({ type: 'error', msg: 'configuration must be valid JSON' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const res = await addApprovalChannel(elevatedSessionId, {
      channelId: addChannelId,
      channelType: addType,
      configuration,
      enabled: true,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Channel ${addChannelId} added. Restart server to apply.`,
      });
      setShowAddForm(false);
      setAddChannelId('');
      selectType('cli');
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add approval channel' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeApprovalChannel(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `Channel ${selectedId} removed. Restart required.` });
      setSelectedId(undefined);
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove approval channel' });
    }
  }

  async function handleToggleEnabled(target: ChannelEntry, nextEnabled: boolean) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateApprovalChannel(elevatedSessionId, target.channelId, {
      enabled: nextEnabled,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Channel ${target.channelId} ${nextEnabled ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update approval channel' });
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
        <AdminManifestTable<ChannelEntry>
          rows={entries}
          idKey="channelId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Channel — ${selected.channelId} (${selected.channelType})` : undefined}
          secretFields={surface.secretFields}
        />
        {isCliChannel ? (
          <div className="nx-admin-channel-cli" data-testid="cli-channel-instructions">
            <h4>CLI approval workflow</h4>
            <p>
              Approval requests on this channel are presented through the management CLI. Operators
              respond from a terminal with one of:
            </p>
            <pre>
              {`nexus approve <approvalId> --approver-id <id>
nexus deny    <approvalId> --approver-id <id>`}
            </pre>
          </div>
        ) : null}
        {isDashboardChannel ? (
          <div className="nx-admin-channel-dashboard">
            <h4>Dashboard channel</h4>
            <p>
              Dashboard approvals route through this elevated session. The channel record is fully
              manageable here; the in-browser approval UX lives at <code>/approvals</code> in a
              follow-on spec.
            </p>
          </div>
        ) : null}
      </div>
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + Add channel
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(selected, !selected.enabled)}
                >
                  {selected.enabled ? 'Disable' : 'Enable'} channel
                </button>
                <button type="button" disabled={busy} onClick={handleDelete}>
                  Delete selected
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add channel
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add approval channel</h4>
          <label>
            Channel ID:{' '}
            <input
              value={addChannelId}
              onChange={e => setAddChannelId(e.target.value)}
              placeholder="e.g. ops-slack"
            />
          </label>
          <label>
            Channel type:{' '}
            <select value={addType} onChange={e => selectType(e.target.value as DiscriminatorType)}>
              {(['cli', 'webhook', 'slack', 'dashboard', 'other'] as DiscriminatorType[]).map(t => (
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
            <button type="button" disabled={busy || !addChannelId} onClick={handleAdd}>
              {busy ? 'Saving…' : 'Save channel'}
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
