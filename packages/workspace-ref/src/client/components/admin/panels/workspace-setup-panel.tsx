// packages/workspace-ref/src/client/components/admin/panels/workspace-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.x — Workspaces surface.
// HANDOFF-CLAUDE-B §6.1 surface #7 — entryMode='governed_only' not editable.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  WORKSPACE_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

interface WorkspaceEntry extends Record<string, unknown> {
  workspaceSocketId: string;
  workspaceType: string;
  enabled: boolean;
  entryMode: string;
  baseUrl: string;
  returnEndpointId: string;
  capabilities: Record<string, boolean>;
}

const COLUMNS: readonly ManifestTableColumn<WorkspaceEntry>[] = [
  { key: 'workspaceSocketId', label: 'socketId' },
  { key: 'workspaceType', label: 'type' },
  { key: 'entryMode', label: 'entryMode' },
  { key: 'baseUrl', label: 'baseUrl' },
];

export function WorkspaceSetupPanel({ data }: Props) {
  const surface = data ?? WORKSPACE_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as WorkspaceEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.workspaceSocketId);
  const selected = entries.find(e => e.workspaceSocketId === selectedId) ?? null;

  return (
    <PanelChrome surface={surface}>
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
          disabledReason={`${PLACEHOLDER_BANNER_REASON} entryMode is non-editable in Beta1.`}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add workspace" />
      </div>
    </PanelChrome>
  );
}
