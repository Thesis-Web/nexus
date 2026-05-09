// packages/workspace-ref/src/client/components/admin/panels/orchestrator-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.x — Orchestrators surface.
// HANDOFF-CLAUDE-B §6.1 surface #6 — OCT-CONFIDENTIAL default per OR-006.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  ORCHESTRATOR_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

interface OrchestratorEntry extends Record<string, unknown> {
  orchestratorSocketId: string;
  orchestratorType: string;
  enabled: boolean;
  plannerMode: string;
  plannerType: string;
  plannerVersion: string;
}

const COLUMNS: readonly ManifestTableColumn<OrchestratorEntry>[] = [
  { key: 'orchestratorSocketId', label: 'socketId' },
  { key: 'orchestratorType', label: 'type' },
  { key: 'plannerMode', label: 'plannerMode' },
  { key: 'plannerType', label: 'plannerType' },
];

export function OrchestratorSetupPanel({ data }: Props) {
  const surface = data ?? ORCHESTRATOR_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as OrchestratorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(
    entries[0]?.orchestratorSocketId
  );
  const selected = entries.find(e => e.orchestratorSocketId === selectedId) ?? null;

  return (
    <PanelChrome surface={surface}>
      <div className="nx-admin-panel__table">
        <AdminManifestTable<OrchestratorEntry>
          rows={entries}
          idKey="orchestratorSocketId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Orchestrator — ${selected.orchestratorSocketId}` : undefined}
          secretFields={surface.secretFields}
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add orchestrator" />
      </div>
    </PanelChrome>
  );
}
