// packages/workspace-ref/src/client/components/admin/panels/toolchain-keys-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Toolchain & keys surface.
// HANDOFF-CLAUDE-B §6.1 surface #11 — secret presence only (OR-DASH-009).
// Q-A turn 04: status pill only; never display secret-store ref string.

import { AdminSecretField } from '../primitives/admin-secret-field.js';
import { AdminDisabledMutationBanner } from '../admin-disabled-mutation-banner.js';
import { TOOLCHAIN_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

export function ToolchainKeysPanel({ data }: Props) {
  const surface = data ?? TOOLCHAIN_PLACEHOLDER;

  return (
    <PanelChrome surface={surface}>
      <AdminDisabledMutationBanner reason="Secret presence only — values are never displayed in this UI (OR-DASH-009). Secret rotation/registration remains CLI / vault flow." />

      <div className="nx-admin-panel__secrets">
        <h3>Detected secret references</h3>
        {surface.secretFields.length === 0 ? (
          <p>(no secret fields detected)</p>
        ) : (
          surface.secretFields.map(sf => (
            <AdminSecretField key={sf.fieldPath} fieldPath={sf.fieldPath} status={sf.status} />
          ))
        )}
      </div>

      <div className="nx-admin-panel__placeholder-list">
        <h4>Source priority (pending OR-DASH-009 owner ruling)</h4>
        <ul>
          <li>Process env (server-side)</li>
          <li>
            <code>keys/</code> directory (control-plane signing material)
          </li>
          <li>Future: vault connector / external secret manager</li>
        </ul>
      </div>
    </PanelChrome>
  );
}
