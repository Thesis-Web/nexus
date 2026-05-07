// packages/workspace-ref/src/client/components/admin/admin-setup-overview.tsx
// SPEC-addendum §6 — AdminSetupOverview.
// Default landing page for the dashboard. Lists all setup surfaces with
// status badges. When wired (Claude C), backed by /workspace/admin/setup/status.
//
// SPEC §7 status truthfulness rule #2: "Missing DI dependencies returning 501
// are not a ready state." Until Claude C ships the projection, every surface
// shows 'partial' to indicate "structure exists but data not wired yet" —
// not 'ready'.

import { AdminSurfaceCard } from './admin-surface-card.js';
import { AdminDisabledMutationBanner } from './admin-disabled-mutation-banner.js';
import type { DashboardReadinessState } from './admin-status.js';

interface SurfaceListItem {
  surfaceId: string;
  title: string;
  state: DashboardReadinessState;
  summary?: string;
}

// Surfaces matching SPEC §3.2 categories.
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
}

export function AdminSetupOverview({ onSelectSurface }: Props) {
  return (
    <div className="nx-admin-setup-overview">
      <h2>Setup overview</h2>
      <AdminDisabledMutationBanner reason="Status data depends on Claude C projection at GET /workspace/admin/setup/status. Save/apply on detail panels is disabled until writer endpoints are ratified." />
      <div className="nx-admin-setup-overview__grid">
        {PLACEHOLDER_SURFACES.map(s => (
          <AdminSurfaceCard
            key={s.surfaceId}
            surfaceId={s.surfaceId}
            title={s.title}
            state={s.state}
            {...(s.summary !== undefined ? { summary: s.summary } : {})}
            onSelect={() => onSelectSurface(s.surfaceId)}
          />
        ))}
      </div>
    </div>
  );
}
