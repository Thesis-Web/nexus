// packages/workspace-ref/src/client/admin-setup-api.ts
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.1 — admin-setup client.
// Sibling of api.ts; kept separate so Claude C's contributions don't
// stomp Claude A's api.ts. After all three deliverables are merged, this
// file's two functions can be moved into api.ts in a cleanup commit.
//
// Both helpers REQUIRE an elevated session id (X-Elevated-Session header)
// because the underlying routes enforce JWT + admin role + elevated session
// per OR-DASH-002 / hard rule 30. The caller obtains the session id from
// the existing vault flow (see vaultChallenge / vaultVerify in api.ts).

import { getToken } from './api.js';
import type { DashboardSetupStatusResponse, DashboardSurfaceStatus } from '@nexus/contracts';

/** Standard API response envelope (matches Claude A's api.ts pattern). */
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function adminFetch<T>(
  path: string,
  elevatedSessionId: string,
  opts: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) ?? {}),
    'X-Elevated-Session': elevatedSessionId,
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  // Normalize two shapes:
  //   • surface route → { ok, data, error }   (already an envelope)
  //   • status route  → DashboardSetupStatusResponse (ok at top level, no data wrap)
  if (body !== null && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if ('data' in obj || 'error' in obj) return body as ApiResponse<T>;
    if (obj['ok'] === true) return { ok: true, data: body as T };
    if (obj['ok'] === false) {
      return { ok: false, error: String(obj['error'] ?? `HTTP ${res.status}`) };
    }
  }
  return { ok: false, error: `HTTP ${res.status}` };
}

/**
 * Fetch the full 11-surface admin setup status response.
 * Returns the raw envelope; callers should check `ok` and read `data` / `error`.
 *
 * @param elevatedSessionId - obtained via vaultVerify; required by route.
 */
export async function getSetupStatus(
  elevatedSessionId: string
): Promise<ApiResponse<DashboardSetupStatusResponse>> {
  return adminFetch<DashboardSetupStatusResponse>(
    '/workspace/admin/setup/status',
    elevatedSessionId
  );
}

/**
 * Fetch a single surface by id (e.g. 'identity', 'workspace', 'toolchain').
 *
 * @param surfaceId - one of the 11 DashboardSurfaceCategory values.
 * @param elevatedSessionId - obtained via vaultVerify; required by route.
 */
export async function getSurfaceStatus(
  surfaceId: string,
  elevatedSessionId: string
): Promise<ApiResponse<DashboardSurfaceStatus>> {
  return adminFetch<DashboardSurfaceStatus>(
    `/workspace/admin/setup/surfaces/${encodeURIComponent(surfaceId)}`,
    elevatedSessionId
  );
}
