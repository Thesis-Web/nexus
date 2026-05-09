// packages/workspace-ref/src/client/components/admin/admin-setup-overview.tsx
// SPEC-addendum §6 — AdminSetupOverview.
// Default landing page for the dashboard. Lists all setup surfaces with
// status badges. Backed by /workspace/admin/setup/status (Claude C projection).
// Claude D: switches between placeholder and real data based on props.

import { AdminSurfaceCard } from './admin-surface-card.js';
import { AdminDisabledMutationBanner } from './admin-disabled-mutation-banner.js';
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

  // Banner text depends on data source.
  const bannerReason = usePlaceholder
    ? 'Save/apply on detail panels requires writer endpoints. Configuration changes are available for endpoints, actors, and connectors.'
    : 'Configuration saved through the dashboard requires a server restart for manifest surfaces (endpoints, connectors). Actor changes take effect immediately.';

  return (
    <div className="nx-admin-setup-overview">
      <h2>Setup overview</h2>
      {loading && <p className="nx-admin-setup-overview__loading">Loading setup status…</p>}
      {error && <p className="nx-admin-setup-overview__error">Error: {error}</p>}
      <AdminDisabledMutationBanner reason={bannerReason} />
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
