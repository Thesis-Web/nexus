// packages/workspace-ref/src/client/components/admin/panels/channel-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.x — Approval channels surface.
// HANDOFF-CLAUDE-B §6.1 surface #5.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  CHANNELS_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
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
];

export function ChannelSetupPanel({ data }: Props) {
  const surface = data ?? CHANNELS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ChannelEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.channelId);
  const selected = entries.find(e => e.channelId === selectedId) ?? null;

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
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add channel" />
      </div>
    </PanelChrome>
  );
}
