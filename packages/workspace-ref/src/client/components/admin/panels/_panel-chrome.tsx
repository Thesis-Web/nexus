// packages/workspace-ref/src/client/components/admin/panels/_panel-chrome.tsx
//
// Internal layout helper shared across all 11 setup panels.
// Renders the common chrome: title + state badge, source paths, blockers,
// evidence. Panel-specific content (manifest tables, forms) is passed as
// `children`.
//
// Not a public primitive — file prefixed with `_` to mark internal-to-panels.
// Per Claude B turn 04: avoids adding a 6th component to the public primitive
// surface owner approved while still keeping panel files focused and DRY.

import type { ReactNode } from 'react';
import { AdminStatusBadge } from '../admin-status-badge.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';

interface Props {
  surface: DashboardSurfaceStatus;
  children: ReactNode;
}

export function PanelChrome({ surface, children }: Props) {
  return (
    <section className="nx-admin-panel">
      <header className="nx-admin-panel__header">
        <h2 className="nx-admin-panel__title">{surface.title}</h2>
        <AdminStatusBadge state={surface.state} />
      </header>

      {surface.sourcePaths.length > 0 && (
        <div className="nx-admin-panel__sources">
          <h4>Source paths</h4>
          <ul>
            {surface.sourcePaths.map(p => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}

      {surface.blockers.length > 0 && (
        <div className="nx-admin-panel__blockers">
          <h4>Blockers</h4>
          <ul>
            {surface.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {surface.evidence.length > 0 && (
        <div className="nx-admin-panel__evidence">
          <h4>Evidence</h4>
          <ul>
            {surface.evidence.map((e, i) => (
              <li key={i}>
                <code>{e.pathOrRoute}</code> — {e.label} <AdminStatusBadge state={e.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
