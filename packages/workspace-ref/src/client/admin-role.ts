// packages/workspace-ref/src/client/admin-role.ts
// SPEC-addendum-beta1-admin-dashboard-v0-1 §2 (admin gate).
// Owner ruling OR-001 (2026-05-06): canonical admin role string is 'nexus-admin'.
// Owner ruling OR-002 (2026-05-06): 'admin' accepted as local/dev alias only.
// Owner ruling OR-002 (2026-05-06): no master key '*'; admin permissions
//   enumerated like a normal user with full access — not a wildcard tier.
//
// MIGRATION NOTE (HOLE-A01 follow-up): These constants should later be moved
// to packages/contracts so backend gating (Claude C) and frontend gating
// (Claude A) reference the same source by import, not by string copy-paste.

/** Canonical admin role string in claims.roleAssignments. */
export const ADMIN_ROLE = 'nexus-admin' as const;

/** Local/dev alias accepted per OR-002. */
export const ADMIN_ROLE_LOCAL_ALIAS = 'admin' as const;

/** UI display label for the admin badge (cosmetics only). */
export const ADMIN_DISPLAY_LABEL = 'Nexus-Admin' as const;

/**
 * Returns true if the given role assignments contain the admin role.
 * Single mapping function per SPEC-addendum §2.3 ("place the admin gate
 * behind a small mapping function, not hard-code scattered role strings").
 */
export function hasAdminRole(roleAssignments: readonly string[] | null | undefined): boolean {
  if (!roleAssignments) return false;
  return roleAssignments.includes(ADMIN_ROLE) || roleAssignments.includes(ADMIN_ROLE_LOCAL_ALIAS);
}
