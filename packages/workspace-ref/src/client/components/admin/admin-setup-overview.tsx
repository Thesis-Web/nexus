// packages/workspace-ref/src/client/components/admin/admin-setup-overview.tsx
// AMEND-nexus-admin-dashboard-full-buildout (Arc 3 fixup) — AdminSetupOverview.
// Default landing page for the dashboard. Lists all setup surfaces with
// status badges. Backed by /workspace/admin/setup/status. The previous
// "writes-not-yet-wired" banner was removed: every surface in NAV now
// has a writer-enabled panel; per-panel save buttons surface their own
// requiresRestart toast on success. The dashboard is double-gated
// (admin role + elevated session) so a chrome-level "Read-only" banner
// is dead state code.

import { AdminSurfaceCard } from './admin-surface-card.js';
import type { DashboardReadinessState, DashboardSurfaceStatus } from '@nexus/contracts';

interface SurfaceListItem {
  surfaceId: string;
  title: string;
  state: DashboardReadinessState;
  summary?: string;
}

// Surfaces matching SPEC §3.2 categories — fallback when API data unavailable.
const PLACEHOLDER_SURFACES: readonly SurfaceListItem[] = [
  {
    surfaceId: 'identity',
    title: 'Identity Providers',
    state: 'partial',
    summary: 'Auth providers, RBAC',
  },
  {
    surfaceId: 'actors_agents',
    title: 'Actors & Agents',
    state: 'partial',
    summary: 'Users, agents, MCP wrappers',
  },
  {
    surfaceId: 'connectors_targets',
    title: 'Connectors & Target Systems',
    state: 'partial',
    summary: 'Postgres, SMTP, Gmail, etc.',
  },
  {
    surfaceId: 'models_nvg',
    title: 'Model Endpoints & Routing',
    state: 'partial',
    summary: 'Llama, GPT, Claude, NVG policy',
  },
  {
    surfaceId: 'channels_approval',
    title: 'Approval Channels',
    state: 'partial',
    summary: 'CLI, webhook, Slack',
  },
  {
    surfaceId: 'workspace',
    title: 'Workspaces',
    state: 'partial',
    summary: 'Workspace sockets and entry mode',
  },
  {
    surfaceId: 'orchestrator',
    title: 'Orchestrators',
    state: 'partial',
    summary: 'Planner runtime config',
  },
  {
    surfaceId: 'mailbox_compile_return',
    title: 'Mailbox / Compile / Return',
    state: 'partial',
    summary: 'Output collection and callback',
  },
  {
    surfaceId: 'modes_policy_oct',
    title: 'Modes, Policy & OCT',
    state: 'partial',
    summary: 'observe / advise / deny + OCT ceilings',
  },
  {
    surfaceId: 'observability',
    title: 'Ledgers & Trails',
    state: 'partial',
    summary: 'Run Ledger, Evidence, Routing Provenance',
  },
  {
    surfaceId: 'toolchain',
    title: 'Toolchain & Keys',
    state: 'partial',
    summary: 'Repo, signing keys, secret refs',
  },
];

interface Props {
  onSelectSurface: (surfaceId: string) => void;
  surfaces?: readonly DashboardSurfaceStatus[];
  loading?: boolean;
  error?: string;
}

export function AdminSetupOverview({ onSelectSurface, surfaces, loading, error }: Props) {
  const usePlaceholder = !surfaces || surfaces.length === 0;

  return (
    <div className="nx-admin-setup-overview">
      <h2>Setup overview</h2>
      {loading && <p className="nx-admin-setup-overview__loading">Loading setup status…</p>}
      {error && <p className="nx-admin-setup-overview__error">Error: {error}</p>}
      <div className="nx-admin-setup-overview__grid">
        {usePlaceholder
          ? PLACEHOLDER_SURFACES.map(s => (
              <AdminSurfaceCard
                key={s.surfaceId}
                surfaceId={s.surfaceId}
                title={s.title}
                state={s.state}
                {...(s.summary !== undefined ? { summary: s.summary } : {})}
                onSelect={() => onSelectSurface(s.surfaceId)}
              />
            ))
          : surfaces.map(s => (
              <AdminSurfaceCard
                key={s.surfaceId}
                surfaceId={s.surfaceId}
                title={s.title}
                state={s.state}
                onSelect={() => onSelectSurface(s.surfaceId)}
              />
            ))}
      </div>
    </div>
  );
}
