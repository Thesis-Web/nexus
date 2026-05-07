// packages/workspace-ref/src/client/components/admin/placeholder/placeholder-types.ts
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — DashboardSetupStatusResponse
// and DashboardSurfaceStatus shape mirror.
//
// LOCAL MIRROR (Claude B): these types live here until Claude C lands the
// canonical projection contract under @nexus/contracts. When Claude C ships
// `GET /workspace/admin/setup/status` and the contract types, panels swap
// these local imports for `import type { ... } from '@nexus/contracts'`.
// See CONTRA-B02 in HOLE_DIFF_LOG (Claude B turn 04).

import type { DashboardReadinessState } from '../admin-status.js';

export type DashboardSurfaceCategory =
  | 'identity'
  | 'actors_agents'
  | 'connectors_targets'
  | 'models_nvg'
  | 'channels_approval'
  | 'workspace'
  | 'orchestrator'
  | 'mailbox_compile_return'
  | 'modes_policy_oct'
  | 'observability'
  | 'toolchain';

export type DashboardSecretFieldStatus = 'present' | 'missing' | 'unknown';

export interface DashboardSecretField {
  readonly fieldPath: string;
  readonly status: DashboardSecretFieldStatus;
}

export interface DashboardEvidenceEntry {
  readonly label: string;
  readonly pathOrRoute: string;
  readonly status: DashboardReadinessState;
}

export type DashboardAllowedAction = 'view' | 'test' | 'mutate_disabled' | 'mutate_available';

/**
 * Per-surface read-only projection — SPEC §3.2.
 * `currentConfiguredValue` is Record<string, unknown> per spec; for surfaces
 * with multiple entries (connectors, endpoints, etc.) the convention used by
 * Claude B's panels is `{ entries: Array<...> }`.
 */
export interface DashboardSurfaceStatus {
  readonly surfaceId: string;
  readonly title: string;
  readonly category: DashboardSurfaceCategory;
  readonly state: DashboardReadinessState;
  readonly sourcePaths: readonly string[];
  readonly currentConfiguredValue: Record<string, unknown>;
  readonly secretFields: readonly DashboardSecretField[];
  readonly blockers: readonly string[];
  readonly evidence: readonly DashboardEvidenceEntry[];
  readonly allowedActions: readonly DashboardAllowedAction[];
}

export interface DashboardModeSummary {
  readonly nxsMode: string;
  readonly nvgMode: string;
  readonly enforcingLocked: boolean;
  readonly state: DashboardReadinessState;
}

export interface DashboardSetupStatusResponse {
  readonly ok: true;
  readonly generatedAt: string;
  readonly generatedBy: {
    readonly actorId: string;
    readonly principalId: string;
  };
  readonly mode: DashboardModeSummary | null;
  readonly surfaces: readonly DashboardSurfaceStatus[];
  readonly summary: {
    readonly ready: number;
    readonly configured: number;
    readonly missing: number;
    readonly disabled: number;
    readonly blocked: number;
    readonly partial: number;
    readonly conditional: number;
    readonly candidate: number;
    readonly future: number;
  };
}
