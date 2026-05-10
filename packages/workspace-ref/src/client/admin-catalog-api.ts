// packages/workspace-ref/src/client/admin-catalog-api.ts
// SPEC-ADMIN-CATALOG-EDITABLE-FORMS §5 — client for the admin catalog +
// model-discovery routes added in admin-writer.ts. Sibling of admin-setup-api.ts
// and admin-writer-api.ts; same elevated-session header convention.

import { getToken } from './api.js';

export interface AdminCatalogActorClass {
  id: string;
  label: string;
}
export interface AdminCatalogOctLevel {
  id: string;
  label: string;
  actionRiskCeiling: string;
  modelTierCeiling: readonly string[];
  dataClassCeiling: readonly string[];
}
export interface AdminCatalogRiskTier {
  id: string;
  label: string;
  order: number;
}
export interface AdminCatalogModelTier {
  id: string;
  label: string;
}
export interface AdminCatalogAuthKind {
  id: string;
  label: string;
  requiresSecret: boolean;
}

export interface AdminCatalogActorEntry extends Record<string, unknown> {
  actorId: string;
  actorClass: string;
  principalId: string;
  displayName: string;
  environment: string;
  octLevel: string | null;
  riskCeiling: string;
  allowedSystems: readonly string[];
  allowedCapabilities?: readonly string[];
  enabled?: boolean;
  registeredAt: string;
  owner?: string;
  purpose?: string;
  reviewCadence?: string;
  /**
   * HOLE-A02 closure (cb1e07c) — Actor.roles is now a Layer-2 contract
   * field, persisted in SQLite. Surfaced here so the admin panel can
   * show role assignments (especially admin) per actor. Mutations are
   * NOT wired in this surface — granting / revoking roles is sensitive
   * and waits on a dedicated guarded writer endpoint.
   */
  roles?: readonly string[];
}
export interface AdminCatalogPrincipal extends Record<string, unknown> {
  principalId: string;
  displayName: string;
  email: string;
  registeredAt: string;
  maxDelegableRiskTier: string;
  allowedSystems: readonly string[];
}

export interface AdminCatalog {
  actorClasses: readonly AdminCatalogActorClass[];
  octLevels: readonly AdminCatalogOctLevel[];
  riskTiers: readonly AdminCatalogRiskTier[];
  modelTiers: readonly AdminCatalogModelTier[];
  capabilityIds: readonly string[];
  authKinds: readonly AdminCatalogAuthKind[];
  allEndpoints: ReadonlyArray<Record<string, unknown>>;
  allConnectors: ReadonlyArray<Record<string, unknown>>;
  allActors: readonly AdminCatalogActorEntry[];
  principals: readonly AdminCatalogPrincipal[];
}

export interface DiscoveredModel {
  name: string;
  model?: string;
  size?: number;
  modifiedAt?: string;
}
export interface DiscoverResult {
  probedUrl: string;
  models: readonly DiscoveredModel[];
}

interface CatalogResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function catalogFetch<T>(
  path: string,
  elevatedSessionId: string,
  init: RequestInit = {}
): Promise<CatalogResponse<T>> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
    'X-Elevated-Session': elevatedSessionId,
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if ('data' in obj || 'error' in obj) return parsed as CatalogResponse<T>;
    if (obj['ok'] === true) return { ok: true, data: parsed as T };
    if (obj['ok'] === false) {
      return { ok: false, error: String(obj['error'] ?? `HTTP ${res.status}`) };
    }
  }
  return { ok: false, error: `HTTP ${res.status}` };
}

/** Fetch the admin catalog (governed constants + raw manifest entries). */
export async function getCatalog(
  elevatedSessionId: string
): Promise<CatalogResponse<AdminCatalog>> {
  return catalogFetch<AdminCatalog>('/workspace/admin/setup/catalog', elevatedSessionId);
}

/**
 * Probe an ollama-compatible node for available models.
 * The server normalizes the URL and probes its /api/tags endpoint.
 */
export async function discoverModels(
  elevatedSessionId: string,
  baseUrl: string,
  adapterId?: string
): Promise<CatalogResponse<DiscoverResult>> {
  return catalogFetch<DiscoverResult>('/workspace/admin/setup/discover', elevatedSessionId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, ...(adapterId !== undefined ? { adapterId } : {}) }),
  });
}
