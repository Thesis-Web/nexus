// packages/workspace-ref/src/client/components/admin/admin-dashboard-shell.tsx
// SPEC-addendum §6 — AdminDashboardShell.
// SPEC-addendum §2.1 — auth state machine ends at dashboardReadOnlyMounted.
// Owner ruling SCOPE-A01 (2026-05-06): same React bundle, real /admin URL route.
// Claude B turn 04: surface-id switch routes to per-surface panels (11).
//
// Composition: header (with elevated session countdown + back-to-workspace) +
// left nav (surface list) + main pane (overview, per-surface panel, or
// fallback AdminCategoryPage for unknown ids).

import { useState } from 'react';
import { AdminSetupOverview } from './admin-setup-overview.js';
import { AdminCategoryPage } from './admin-category-page.js';
import { ADMIN_DISPLAY_LABEL } from '../../admin-role.js';

// Per-surface panels (Claude B turn 04)
import { IdentityProviderSetupPanel } from './panels/identity-provider-setup-panel.js';
import { ActorAgentSetupPanel } from './panels/actor-agent-setup-panel.js';
import { ConnectorSetupPanel } from './panels/connector-setup-panel.js';
import { ModelEndpointSetupPanel } from './panels/model-endpoint-setup-panel.js';
import { ChannelSetupPanel } from './panels/channel-setup-panel.js';
import { WorkspaceSetupPanel } from './panels/workspace-setup-panel.js';
import { OrchestratorSetupPanel } from './panels/orchestrator-setup-panel.js';
import { CompileMailboxSetupPanel } from './panels/compile-mailbox-setup-panel.js';
import { ModePolicySetupPanel } from './panels/mode-policy-setup-panel.js';
import { LedgerViewerPanel } from './panels/ledger-viewer-panel.js';
import { ToolchainKeysPanel } from './panels/toolchain-keys-panel.js';

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

/**
 * Surface-id switch — routes to per-surface panels.
 * Unknown surface ids fall through to AdminCategoryPage (placeholder).
 *
 * Future Claude C wire-in: add `data` prop sourced from
 * `await api.getSetupStatus()` and pass each surface's matching
 * DashboardSurfaceStatus into the panel's optional `data` prop.
 */
function renderSurface(surfaceId: string, title: string) {
  switch (surfaceId) {
    case 'identity':
      return <IdentityProviderSetupPanel />;
    case 'actors_agents':
      return <ActorAgentSetupPanel />;
    case 'connectors_targets':
      return <ConnectorSetupPanel />;
    case 'models_nvg':
      return <ModelEndpointSetupPanel />;
    case 'channels_approval':
      return <ChannelSetupPanel />;
    case 'workspace':
      return <WorkspaceSetupPanel />;
    case 'orchestrator':
      return <OrchestratorSetupPanel />;
    case 'mailbox_compile_return':
      return <CompileMailboxSetupPanel />;
    case 'modes_policy_oct':
      return <ModePolicySetupPanel />;
    case 'observability':
      return <LedgerViewerPanel />;
    case 'toolchain':
      return <ToolchainKeysPanel />;
    default:
      return <AdminCategoryPage surfaceId={surfaceId} title={title} />;
  }
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
            renderSurface(activeSurfaceId, activeNav.title)
          )}
        </main>
      </div>
    </div>
  );
}
