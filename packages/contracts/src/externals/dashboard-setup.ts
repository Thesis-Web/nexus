// packages/contracts/src/externals/dashboard-setup.ts
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — DashboardSetupStatusResponse,
// DashboardSurfaceStatus, DashboardReadinessState (9-state union).
//
// Layer 2 — canonical projection contract for the admin dashboard.
// Pinned here so backend projection (Claude C) and frontend gating/display
// (Claude A/B) reference the same source by import — not by string copy.
//
// Owner ruling DRIFT-A01 (2026-05-06): readiness states lowercase always.
// Owner ruling OR-001 (2026-05-06): canonical admin role string is 'nexus-admin'.
// Owner ruling OR-002 (2026-05-06): 'admin' accepted as local/dev alias only;
//   no master key '*' — admin permissions enumerated like a normal user with
//   full access, not as a wildcard tier.
// Owner ruling OR-DASH-009 (open, deferred): secret values NEVER echoed —
//   status pill only ('present' | 'missing' | 'unknown').
//
// This file does not import from any package other than the contracts types,
// keeping it Layer-2 pure. Plugin authors and frontend bundles can import
// freely.

import type { NonEmpty } from '../types/index.js';

// ─── DashboardReadinessState ────────────────────────────────────────────────
//
// 9-state union from SPEC §3.2. Lowercase by owner ruling (DRIFT-A01).
// The dashboard normalizes the readiness-matrix vocabulary
// (READY/READ_ONLY/PARTIAL/CONDITIONAL/BLOCKED/CANDIDATE) into this enum at
// the API boundary.

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

/** Iteration-friendly tuple of all 9 states. */
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

// ─── DashboardSurfaceCategory ───────────────────────────────────────────────
//
// 11-surface category enum. Each setup-status response MUST emit exactly one
// surface per category (per Claude B's panels' wired surfaceIds).

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

/** Iteration-friendly tuple of all 11 categories — used for surface-count gates. */
export const ALL_SURFACE_CATEGORIES: readonly DashboardSurfaceCategory[] = [
  'identity',
  'actors_agents',
  'connectors_targets',
  'models_nvg',
  'channels_approval',
  'workspace',
  'orchestrator',
  'mailbox_compile_return',
  'modes_policy_oct',
  'observability',
  'toolchain',
] as const;

// ─── Secret + evidence + action shapes ──────────────────────────────────────

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

// ─── DashboardSurfaceStatus ────────────────────────────────────────────────
//
// Per-surface read-only projection. `currentConfiguredValue` is
// `Record<string, unknown>` per SPEC §3.2; the convention used by
// Claude B's panels for multi-entry surfaces is `{ entries: [...] }`.
// Mailbox/compile/return surface uses named subfields like
// `{ mailboxes: [...], compilers: [...], returnEndpoints: [...] }`.

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

// ─── DashboardModeSummary ───────────────────────────────────────────────────

export interface DashboardModeSummary {
  readonly nxsMode: string;
  readonly nvgMode: string;
  readonly enforcingLocked: boolean;
  readonly state: DashboardReadinessState;
}

// ─── DashboardSetupStatusResponse ───────────────────────────────────────────

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

// ─── Admin role gating ──────────────────────────────────────────────────────
//
// Pinned here per Claude A's MIGRATION NOTE in admin-role.ts: backend gating
// (Claude C) and frontend gating (Claude A) MUST reference the same source by
// import, not by string copy. See SPEC-addendum §2.3 ("place the admin gate
// behind a small mapping function, not hard-code scattered role strings").
//
// `hasAdminRole` accepts `readonly string[] | null | undefined` to match
// `IdentityClaims.roleAssignments: NonEmpty[]` (which is structurally a
// readonly string[] from the consumer's view). A null/undefined argument
// returns false (no implicit admin grant).

/** Canonical admin role string in claims.roleAssignments. */
export const ADMIN_ROLE: NonEmpty = 'nexus-admin' as NonEmpty;

/** Local/dev alias accepted per OR-002. */
export const ADMIN_ROLE_LOCAL_ALIAS: NonEmpty = 'admin' as NonEmpty;

/** UI display label for the admin badge (cosmetics only). */
export const ADMIN_DISPLAY_LABEL = 'Nexus-Admin' as const;

/**
 * Returns true if the given role assignments contain the admin role.
 * Single mapping function per SPEC-addendum §2.3.
 *
 * Accepts null/undefined for ergonomic call-sites (e.g.
 * `hasAdminRole(claims?.roleAssignments)`).
 */
export function hasAdminRole(roleAssignments: readonly string[] | null | undefined): boolean {
  if (!roleAssignments) return false;
  return (
    roleAssignments.includes(ADMIN_ROLE as string) ||
    roleAssignments.includes(ADMIN_ROLE_LOCAL_ALIAS as string)
  );
}

/**
 * Capability-name mapping for OR-DASH-001 (pending owner ratification).
 * Until ratified, every dashboard capability is permitted iff the caller
 * has the admin role. After ratification, this mapping is the single point
 * to wire in the ratified capability strings (e.g.
 * 'nexus.admin.dashboard.view' / '.mutate' / '.manifest.change' / etc.).
 *
 * The function shape is stable so future owner ratification is a one-line
 * change here, not scattered across routes.
 */
export function hasDashboardViewCapability(
  roleAssignments: readonly string[] | null | undefined
): boolean {
  // Until OR-DASH-001 ratifies, view permission == admin role.
  return hasAdminRole(roleAssignments);
}
