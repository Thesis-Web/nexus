// packages/workspace-ref/src/client/components/admin/admin-status-badge.tsx
// SPEC-addendum §6 — AdminStatusBadge.
// SPEC-addendum §3.2 — 9-state DashboardReadinessState vocabulary.
// Owner ruling DRIFT-A01 (2026-05-06): lowercase always.

import type { DashboardReadinessState } from '@nexus/contracts';

interface Props {
  state: DashboardReadinessState;
  label?: string;
}

export function AdminStatusBadge({ state, label }: Props) {
  return (
    <span className={`nx-admin-status-badge nx-admin-status-badge--${state}`}>
      {label ?? state}
    </span>
  );
}
