/**
 * Admin Dashboard Auth Helper — shared check for the workspace-attached admin
 * surfaces (admin-writer + admin-ledger).
 *
 * Auth chain: workspace JWT (already enforced by /workspace/* middleware)
 *   → nexus-admin role
 *   → X-Elevated-Session header validated against the principalId on the JWT.
 *
 * This file exists so the route modules that need this check don't duplicate
 * it. The spec calls out "do NOT duplicate the auth logic"; lifting the
 * helper here keeps it single-sourced. admin-writer.ts and admin-ledger.ts
 * both import `checkAdminAuth` from here.
 *
 * Layer 7 — imports @nexus/contracts ONLY.
 */

import type { Request, Response } from 'express';
import type { ElevatedAuthProvider, IdentityClaims, Uuid } from '@nexus/contracts';
import { hasAdminRole } from '@nexus/contracts';

/** Minimal dep surface required by `checkAdminAuth`. */
export interface AdminAuthDeps {
  readonly elevatedAuthProvider?: ElevatedAuthProvider;
}

export interface AdminAuthOk {
  readonly ok: true;
  readonly claims: IdentityClaims;
  readonly actorId: string;
  readonly principalId: string;
}

export interface AdminAuthFail {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
}

export type AdminAuthResult = AdminAuthOk | AdminAuthFail;

/**
 * Verify the request comes from an admin with a valid elevated session.
 *
 * Preconditions: the workspace JWT middleware has already populated
 * `res.locals.claims`, `res.locals.actorId`, `res.locals.principalId`.
 *
 * Returns AdminAuthOk on success; the caller writes the response on failure
 * using `{ status, error }`.
 */
export async function checkAdminAuth(
  req: Request,
  res: Response,
  deps: AdminAuthDeps
): Promise<AdminAuthResult> {
  const claims = res.locals['claims'] as IdentityClaims | undefined;
  const actorId = res.locals['actorId'] as string | undefined;
  const principalId = res.locals['principalId'] as string | undefined;
  if (!claims || !actorId || !principalId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (!hasAdminRole(claims.roleAssignments)) {
    return { ok: false, status: 403, error: 'Admin role required' };
  }
  if (!deps.elevatedAuthProvider) {
    return { ok: false, status: 403, error: 'Elevated session validator not configured' };
  }
  const elevatedSessionId = req.headers['x-elevated-session'] as string | undefined;
  if (!elevatedSessionId) {
    return { ok: false, status: 403, error: 'X-Elevated-Session header required' };
  }
  try {
    const status = await deps.elevatedAuthProvider.validateSession(
      elevatedSessionId as Uuid,
      principalId
    );
    if (!status.valid) {
      return { ok: false, status: 403, error: 'Elevated session invalid or expired' };
    }
  } catch {
    return { ok: false, status: 403, error: 'Elevated session validation failed' };
  }
  return { ok: true, claims, actorId, principalId };
}
