// packages/workspace-ref/src/client/components/admin/panels/channel-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.x — Approval channels surface.
// CLAUDE-CODE-ADMIN-PANELS-PHASE-D §2 — wired to real channel manifest data.
// The dashboard approval channel (in-browser Gate 05 approvals) is deferred
// to a dedicated spec; this panel ships read-only with the CLI channel
// surfaced from `config/channels/channels.v1.yaml`.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { CHANNELS_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
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

export function ChannelSetupPanel({ data }: Props) {
  const surface = data ?? CHANNELS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ChannelEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.channelId);
  const selected = entries.find(e => e.channelId === selectedId) ?? null;

  // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §2b — surface CLI-specific
  // instructions when the selected channel is the management CLI.
  // Other channel types render the generic read form only.
  const isCliChannel =
    selected !== null && (selected.channelType === 'cli' || selected.channelId === 'cli');

  return (
    <PanelChrome surface={surface}>
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
          disabledReason="Channel mutation deferred — manifest changes require restart and a signed admin command."
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
            <p className="nx-admin-channel-cli-deferred">
              In-browser dashboard approvals are planned but not yet wired — they require a
              registered approver-key verification path and a dedicated channel implementation.
            </p>
          </div>
        ) : null}
      </div>
    </PanelChrome>
  );
}
