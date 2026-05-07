// packages/workspace-ref/src/client/components/admin/panels/model-endpoint-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.3 — Model endpoint / NVG surface.
// HANDOFF-CLAUDE-B §6.1 surface #4 — Llama / GPT / Claude per OR-003.
// OR-DASH-009: secret presence only.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  MODELS_NVG_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
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

export function ModelEndpointSetupPanel({ data }: Props) {
  const surface = data ?? MODELS_NVG_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as EndpointEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.endpointId);
  const selected = entries.find(e => e.endpointId === selectedId) ?? null;

  // Filter secret fields to only those tied to the selected endpoint, by fieldPath suffix.
  const selectedSecrets = selected
    ? surface.secretFields.filter(sf => sf.fieldPath.includes(`[${selected.endpointId}]`))
    : surface.secretFields;

  return (
    <PanelChrome surface={surface}>
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
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add endpoint" />
      </div>
    </PanelChrome>
  );
}
