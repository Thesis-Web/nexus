// packages/workspace-ref/src/client/components/admin/admin-dashboard-shell.tsx
// SPEC-addendum §6 — AdminDashboardShell.
// SPEC-addendum §2.1 — auth state machine ends at dashboardReadOnlyMounted.
// Owner ruling SCOPE-A01 (2026-05-06): same React bundle, real /admin URL route.
// Claude B turn 04: surface-id switch routes to per-surface panels (11).
//
// Composition: header (with elevated session countdown + back-to-workspace) +
// left nav (surface list) + main pane (overview, per-surface panel, or
// fallback AdminCategoryPage for unknown ids).

import { useState, useEffect } from 'react';
import { AdminSetupOverview } from './admin-setup-overview.js';
import { AdminCategoryPage } from './admin-category-page.js';
import { ADMIN_DISPLAY_LABEL } from '../../admin-role.js';
import { getSetupStatus } from '../../admin-setup-api.js';
import type { DashboardSetupStatusResponse, DashboardSurfaceStatus } from '@nexus/contracts';

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
  elevatedSessionId: string;
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
 * Claude C wire-in: `data` sourced from `getSetupStatus()` response.
 * Each panel's optional `data` prop receives its matching surface;
 * panels fall back to placeholder data when `data` is undefined.
 */
function renderSurface(surfaceId: string, title: string, data: DashboardSurfaceStatus | undefined) {
  // exactOptionalPropertyTypes: panels declare `data?: DashboardSurfaceStatus`
  // so we must omit the prop entirely when data is undefined, not pass undefined.
  const dataProps = data ? { data } : {};
  switch (surfaceId) {
    case 'identity':
      return <IdentityProviderSetupPanel {...dataProps} />;
    case 'actors_agents':
      return <ActorAgentSetupPanel {...dataProps} />;
    case 'connectors_targets':
      return <ConnectorSetupPanel {...dataProps} />;
    case 'models_nvg':
      return <ModelEndpointSetupPanel {...dataProps} />;
    case 'channels_approval':
      return <ChannelSetupPanel {...dataProps} />;
    case 'workspace':
      return <WorkspaceSetupPanel {...dataProps} />;
    case 'orchestrator':
      return <OrchestratorSetupPanel {...dataProps} />;
    case 'mailbox_compile_return':
      return <CompileMailboxSetupPanel {...dataProps} />;
    case 'modes_policy_oct':
      return <ModePolicySetupPanel {...dataProps} />;
    case 'observability':
      return <LedgerViewerPanel {...dataProps} />;
    case 'toolchain':
      return <ToolchainKeysPanel {...dataProps} />;
    default:
      return <AdminCategoryPage surfaceId={surfaceId} title={title} />;
  }
}

export function AdminDashboardShell({
  principalId,
  elevatedSessionId,
  remainingSeconds,
  onExitToWorkspace,
  onLogoutElevated,
}: Props) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>('overview');
  const activeNav = NAV.find(n => n.surfaceId === activeSurfaceId) ?? NAV[0]!;

  // ── Fetch setup status from Claude C projection routes ──────────────────
  const [setupData, setSetupData] = useState<DashboardSetupStatusResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);

  useEffect(() => {
    if (!elevatedSessionId) return;
    let cancelled = false;
    setSetupLoading(true);
    void (async () => {
      try {
        const res = await getSetupStatus(elevatedSessionId);
        if (cancelled) return;
        if (res.ok && res.data) {
          setSetupData(res.data);
          setSetupError(null);
        } else {
          setSetupError(res.error ?? 'Failed to load setup status');
        }
      } catch (err) {
        if (!cancelled) {
          setSetupError(err instanceof Error ? err.message : 'Network error');
        }
      } finally {
        if (!cancelled) setSetupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [elevatedSessionId]);

  function findSurface(surfaceId: string): DashboardSurfaceStatus | undefined {
    return setupData?.surfaces.find(s => s.surfaceId === surfaceId);
  }

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
          {setupLoading && (
            <div className="nx-admin-shell__loading" role="status">
              Loading setup status…
            </div>
          )}
          {setupError && (
            <div className="nx-admin-shell__error" role="alert">
              Setup status unavailable: {setupError}
            </div>
          )}
          {activeSurfaceId === 'overview' ? (
            <AdminSetupOverview
              onSelectSurface={setActiveSurfaceId}
              {...(setupData?.surfaces ? { surfaces: setupData.surfaces } : {})}
              loading={setupLoading}
              error={setupError}
            />
          ) : (
            renderSurface(activeSurfaceId, activeNav.title, findSurface(activeSurfaceId))
          )}
        </main>
      </div>
    </div>
  );
}
