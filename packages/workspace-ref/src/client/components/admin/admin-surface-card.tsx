// packages/workspace-ref/src/client/components/admin/admin-surface-card.tsx
// SPEC-addendum §6 — AdminSurfaceCard.
// One card per setup surface on AdminSetupOverview.

import { AdminStatusBadge } from './admin-status-badge.js';
import type { DashboardReadinessState } from '@nexus/contracts';

export interface SurfaceCardProps {
  surfaceId: string;
  title: string;
  state: DashboardReadinessState;
  summary?: string;
  onSelect?: () => void;
}

export function AdminSurfaceCard({ surfaceId, title, state, summary, onSelect }: SurfaceCardProps) {
  return (
    <button
      type="button"
      className="nx-admin-surface-card"
      onClick={onSelect}
      data-surface-id={surfaceId}
    >
      <div className="nx-admin-surface-card__title">{title}</div>
      <AdminStatusBadge state={state} />
      {summary && <div className="nx-admin-surface-card__summary">{summary}</div>}
    </button>
  );
}
