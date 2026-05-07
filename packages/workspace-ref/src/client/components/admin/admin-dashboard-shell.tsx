// packages/workspace-ref/src/client/components/admin/admin-dashboard-shell.tsx
// SPEC-addendum §6 — AdminDashboardShell.
// SPEC-addendum §2.1 — auth state machine ends at dashboardReadOnlyMounted.
// Owner ruling SCOPE-A01 (2026-05-06): same React bundle, real /admin URL route.
//
// Composition: header (with elevated session countdown + back-to-workspace) +
// left nav (surface list) + main pane (overview or category page).

import { useState } from 'react';
import { AdminSetupOverview } from './admin-setup-overview.js';
import { AdminCategoryPage } from './admin-category-page.js';
import { ADMIN_DISPLAY_LABEL } from '../../admin-role.js';

interface NavItem {
  surfaceId: string;
  title: string;
}

const NAV: readonly NavItem[] = [
  { surfaceId: 'overview', title: 'Setup overview' },
  { surfaceId: 'identity', title: 'Identity Providers' },
  { surfaceId: 'actors_agents', title: 'Actors & Agents' },
  { surfaceId: 'connectors_targets', title: 'Connectors & Target Systems' },
  { surfaceId: 'models_nvg', title: 'Model Endpoints & Routing' },
  { surfaceId: 'channels_approval', title: 'Approval Channels' },
  { surfaceId: 'workspace', title: 'Workspaces' },
  { surfaceId: 'orchestrator', title: 'Orchestrators' },
  { surfaceId: 'mailbox_compile_return', title: 'Mailbox / Compile / Return' },
  { surfaceId: 'modes_policy_oct', title: 'Modes, Policy & OCT' },
  { surfaceId: 'observability', title: 'Ledgers & Trails' },
  { surfaceId: 'toolchain', title: 'Toolchain & Keys' },
];

interface Props {
  principalId: string;
  remainingSeconds: number;
  onExitToWorkspace: () => void;
  onLogoutElevated: () => void;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'expired';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AdminDashboardShell({
  principalId,
  remainingSeconds,
  onExitToWorkspace,
  onLogoutElevated,
}: Props) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>('overview');
  const activeNav = NAV.find(n => n.surfaceId === activeSurfaceId) ?? NAV[0]!;

  return (
    <div className="nx-admin-shell">
      <header className="nx-admin-shell__header">
        <span className="nx-admin-shell__title">{ADMIN_DISPLAY_LABEL}</span>
        <span className="nx-admin-shell__principal">
          Principal: <code>{principalId || '(unknown)'}</code>
        </span>
        <div className="nx-admin-shell__spacer" />
        <span className="nx-admin-shell__elev" title="Elevated session remaining">
          Elevated: {formatRemaining(remainingSeconds)}
        </span>
        <button type="button" onClick={onExitToWorkspace}>
          Back to workspace
        </button>
        <button type="button" onClick={onLogoutElevated}>
          End admin session
        </button>
      </header>

      <div className="nx-admin-shell__body">
        <nav className="nx-admin-shell__nav" aria-label="Admin surfaces">
          {NAV.map(n => (
            <button
              key={n.surfaceId}
              type="button"
              className={
                n.surfaceId === activeSurfaceId
                  ? 'nx-admin-shell__nav-item nx-admin-shell__nav-item--active'
                  : 'nx-admin-shell__nav-item'
              }
              onClick={() => setActiveSurfaceId(n.surfaceId)}
            >
              {n.title}
            </button>
          ))}
        </nav>

        <main className="nx-admin-shell__content">
          {activeSurfaceId === 'overview' ? (
            <AdminSetupOverview onSelectSurface={setActiveSurfaceId} />
          ) : (
            <AdminCategoryPage surfaceId={activeSurfaceId} title={activeNav.title} />
          )}
        </main>
      </div>
    </div>
  );
}
