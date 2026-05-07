// packages/workspace-ref/src/client/components/admin/admin-status.ts
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — DashboardReadinessState (9-state).
// Owner ruling DRIFT-A01 (2026-05-06): lowercase always.
//
// Backend projection (Claude C) normalizes corpus matrix readiness
// (READY/READ_ONLY/PARTIAL/CONDITIONAL/BLOCKED/CANDIDATE) into this enum
// at the API boundary (GET /workspace/admin/setup/status).

export type DashboardReadinessState =
  | 'ready'
  | 'configured'
  | 'missing'
  | 'disabled'
  | 'blocked'
  | 'partial'
  | 'conditional'
  | 'candidate'
  | 'future';

export const ALL_READINESS_STATES: readonly DashboardReadinessState[] = [
  'ready',
  'configured',
  'missing',
  'disabled',
  'blocked',
  'partial',
  'conditional',
  'candidate',
  'future',
] as const;
