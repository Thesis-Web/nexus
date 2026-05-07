// packages/workspace-ref/src/client/components/admin/panels/ledger-viewer-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Observability / Run Ledger surface.
// HANDOFF-CLAUDE-B §6.1 surface #10 — Run Ledger viewer per OR-007.
// OR-DASH-004: browser cannot use admin bearer; reads await Claude C JWT projection.
//
// This panel renders an honest "pending projection" state. There is no
// browser-callable read-route yet; admin-bearer routes (`/run-ledger`,
// `/ledger`) are forbidden from the browser.

import { AdminDisabledMutationBanner } from '../admin-disabled-mutation-banner.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import {
  OBSERVABILITY_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

export function LedgerViewerPanel({ data }: Props) {
  const surface = data ?? OBSERVABILITY_PLACEHOLDER;

  return (
    <PanelChrome surface={surface}>
      <AdminDisabledMutationBanner reason="Browser-side ledger viewing requires a workspace-JWT projection of Run Ledger / Evidence Ledger / Routing Trail. Admin-bearer ledger routes are not callable from the browser (OR-DASH-004). Pending Claude C." />

      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={surface.currentConfiguredValue}
          title="Ledger source surfaces"
          secretFields={surface.secretFields}
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>

      <div className="nx-admin-panel__placeholder-list">
        <h4>Future browser views (Claude C)</h4>
        <ul>
          <li>
            <code>GET /workspace/admin/run-ledger?...</code> — recent runs, filterable
          </li>
          <li>
            <code>GET /workspace/admin/evidence?...</code> — evidence stream + chain verify
          </li>
          <li>
            <code>GET /workspace/admin/routing-trail?...</code> — per-run routing decisions
          </li>
        </ul>
      </div>
    </PanelChrome>
  );
}
