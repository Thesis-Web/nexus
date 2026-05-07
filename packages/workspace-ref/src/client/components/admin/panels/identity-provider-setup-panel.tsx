// packages/workspace-ref/src/client/components/admin/panels/identity-provider-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.1 — Identity provider surface.
// HANDOFF-CLAUDE-B §6.1 surface #1.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  IDENTITY_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

interface IdentityEntry extends Record<string, unknown> {
  providerId: string;
  providerType: string;
  configuration: Record<string, unknown>;
  enabled: boolean;
}

const COLUMNS: readonly ManifestTableColumn<IdentityEntry>[] = [
  { key: 'providerId', label: 'providerId' },
  { key: 'providerType', label: 'providerType' },
];

export function IdentityProviderSetupPanel({ data }: Props) {
  const surface = data ?? IDENTITY_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as IdentityEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(entries[0]?.providerId);
  const selected = entries.find(e => e.providerId === selectedId) ?? null;

  return (
    <PanelChrome surface={surface}>
      <div className="nx-admin-panel__table">
        <AdminManifestTable<IdentityEntry>
          rows={entries}
          idKey="providerId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Identity provider — ${selected.providerId}` : undefined}
          secretFields={surface.secretFields}
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
      <div className="nx-admin-panel__actions">
        <AdminAddNewButton label="Add provider" />
      </div>
    </PanelChrome>
  );
}
