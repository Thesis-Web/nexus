// packages/workspace-ref/src/client/components/admin/panels/connector-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.2 — Connectors / target systems.
// HANDOFF-CLAUDE-B §6.1 surface #3, OR-005 (14 connector kinds — read-only).

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  CONNECTORS_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
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

export function ConnectorSetupPanel({ data }: Props) {
  const surface = data ?? CONNECTORS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ConnectorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.connectorId);
  const selected = entries.find(e => e.connectorId === selectedId) ?? null;

  return (
    <PanelChrome surface={surface}>
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
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add connector" />
      </div>
    </PanelChrome>
  );
}
