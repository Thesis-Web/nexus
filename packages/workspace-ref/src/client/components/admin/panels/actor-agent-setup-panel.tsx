// packages/workspace-ref/src/client/components/admin/panels/actor-agent-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Actors & agents surface.
// HANDOFF-CLAUDE-B §6.1 surface #2 — 3 sub-flows (user / agent / MCP wrapper).
// Flagged HOLE-A02: Actor.roles?: NonEmpty[] missing from Layer-2 contract.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  ACTORS_AGENTS_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
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

export function ActorAgentSetupPanel({ data }: Props) {
  const surface = data ?? ACTORS_AGENTS_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as ActorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.actorId);
  const selected = entries.find(e => e.actorId === selectedId) ?? null;

  return (
    <PanelChrome surface={surface}>
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
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add user / agent / MCP wrapper" />
      </div>
    </PanelChrome>
  );
}
