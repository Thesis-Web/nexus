// packages/workspace-ref/src/client/components/admin/admin-dashboard-shell.tsx
// SPEC-addendum §6 — AdminDashboardShell.
// SPEC-addendum §2.1 — auth state machine ends at dashboardReadOnlyMounted.
// Owner ruling SCOPE-A01 (2026-05-06): same React bundle, real /admin URL route.
// Claude B turn 04: surface-id switch routes to per-surface panels (11).
// Claude C: data fetch from GET /workspace/admin/setup/status.
// Claude D: pass elevatedSessionId to panels for writer operations.
//
// Composition: header (with elevated session countdown + back-to-workspace) +
// left nav (surface list) + main pane (overview, per-surface panel, or
// fallback AdminCategoryPage for unknown ids).

import { useState, useEffect } from 'react';
import { AdminSetupOverview } from './admin-setup-overview.js';
import { AdminCategoryPage } from './admin-category-page.js';
import { ADMIN_DISPLAY_LABEL } from '@nexus/contracts';
import { getSetupStatus } from '../../admin-setup-api.js';
import { getCatalog, type AdminCatalog } from '../../admin-catalog-api.js';
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
  remainingSeconds: number;
  elevatedSessionId: string;
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
 * Claude D: panels for the 3 writer surfaces receive `elevatedSessionId`
 * so they can POST/PUT/DELETE through the admin-writer routes.
 */
function renderSurface(
  surfaceId: string,
  title: string,
  data: DashboardSurfaceStatus | undefined,
  elevatedSessionId: string,
  adminPrincipalId: string,
  catalog: AdminCatalog | null,
  onCatalogReload: () => void
) {
  switch (surfaceId) {
    case 'identity':
      return <IdentityProviderSetupPanel {...(data ? { data } : {})} />;
    case 'actors_agents':
      return (
        <ActorAgentSetupPanel
          {...(data ? { data } : {})}
          elevatedSessionId={elevatedSessionId}
          adminPrincipalId={adminPrincipalId}
          {...(catalog ? { catalog } : {})}
          onCatalogReload={onCatalogReload}
        />
      );
    case 'connectors_targets':
      return (
        <ConnectorSetupPanel {...(data ? { data } : {})} elevatedSessionId={elevatedSessionId} />
      );
    case 'models_nvg':
      return (
        <ModelEndpointSetupPanel
          {...(data ? { data } : {})}
          elevatedSessionId={elevatedSessionId}
          {...(catalog ? { catalog } : {})}
          onCatalogReload={onCatalogReload}
        />
      );
    case 'channels_approval':
      return <ChannelSetupPanel {...(data ? { data } : {})} />;
    case 'workspace':
      return <WorkspaceSetupPanel {...(data ? { data } : {})} />;
    case 'orchestrator':
      return <OrchestratorSetupPanel {...(data ? { data } : {})} />;
    case 'mailbox_compile_return':
      return <CompileMailboxSetupPanel {...(data ? { data } : {})} />;
    case 'modes_policy_oct':
      return <ModePolicySetupPanel {...(data ? { data } : {})} />;
    case 'observability':
      return (
        <LedgerViewerPanel {...(data ? { data } : {})} elevatedSessionId={elevatedSessionId} />
      );
    case 'toolchain':
      return <ToolchainKeysPanel {...(data ? { data } : {})} />;
    default:
      return <AdminCategoryPage surfaceId={surfaceId} title={title} />;
  }
}

export function AdminDashboardShell({
  principalId,
  remainingSeconds,
  elevatedSessionId,
  onExitToWorkspace,
  onLogoutElevated,
}: Props) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>('overview');
  const activeNav = NAV.find(n => n.surfaceId === activeSurfaceId) ?? NAV[0]!;

  // ── Data fetch from projection API (Claude C backend) ───────────────────
  const [setupData, setSetupData] = useState<DashboardSetupStatusResponse | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);

  useEffect(() => {
    if (!elevatedSessionId) return;
    let cancelled = false;
    setSetupLoading(true);
    getSetupStatus(elevatedSessionId)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setSetupData(res.data);
          setSetupError(null);
        } else {
          setSetupError(res.error ?? 'Failed to load setup status');
        }
        setSetupLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setSetupError(String(err));
        setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [elevatedSessionId]);

  // ── Catalog fetch (governed constants + raw manifest entries) ───────────
  // Reused by every dynamic-dropdown panel; refreshed after writer mutations
  // via the onCatalogReload callback so newly added/edited entries appear.
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [catalogReloadCounter, setCatalogReloadCounter] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!elevatedSessionId) return;
    let cancelled = false;
    getCatalog(elevatedSessionId)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setCatalog(res.data);
          setCatalogError(null);
        } else {
          setCatalogError(res.error ?? 'Failed to load catalog');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setCatalogError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [elevatedSessionId, catalogReloadCounter]);

  const reloadCatalog = (): void => setCatalogReloadCounter(c => c + 1);

  /** Lookup a single surface by id from the fetched status data. */
  function findSurface(surfaceId: string): DashboardSurfaceStatus | undefined {
    if (!setupData) return undefined;
    return setupData.surfaces.find(s => s.surfaceId === surfaceId);
  }

  return (
    <div className="nx-admin-shell">
      <header className="nx-admin-shell__header">
        <span className="nx-admin-shell__title">{ADMIN_DISPLAY_LABEL}</span>
        <span className="nx-admin-shell__principal">
          Principal: <code>{principalId || '(unknown)'}</code>
        </span>
        <div className="nx-admin-shell__spacer" />
        {setupLoading && <span className="nx-admin-shell__loading">Loading…</span>}
        {setupError && (
          <span className="nx-admin-shell__error" title={setupError}>
            ⚠ data error
          </span>
        )}
        {catalogError && (
          <span className="nx-admin-shell__error" title={catalogError}>
            ⚠ catalog error
          </span>
        )}
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
            <AdminSetupOverview
              onSelectSurface={setActiveSurfaceId}
              {...(setupData ? { surfaces: setupData.surfaces } : {})}
              {...(setupLoading ? { loading: true } : {})}
              {...(setupError ? { error: setupError } : {})}
            />
          ) : (
            renderSurface(
              activeSurfaceId,
              activeNav.title,
              findSurface(activeSurfaceId),
              elevatedSessionId,
              principalId,
              catalog,
              reloadCatalog
            )
          )}
        </main>
      </div>
    </div>
  );
}
