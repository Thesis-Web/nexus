/**
 * Admin Dashboard Writer Routes — SPEC-ADMIN-WRITER §4–§6
 *
 * File: packages/interfaces/api/src/routes/admin-writer.ts
 * Layer 7 — workspace-attached admin mutation routes.
 *
 * Three surfaces:
 *   1. Model endpoints — YAML manifest writer (requires restart)
 *   2. Actors & agents — SQLite ActorRegistry (immediate)
 *   3. Connectors — YAML manifest writer (requires restart)
 *
 * Auth chain: workspace JWT → nexus-admin role → X-Elevated-Session.
 *
 * Import law: This file is Layer 7. It imports ONLY from @nexus/contracts
 * (types + value imports via project references) and local route helpers.
 * The ManifestWriter implementation is injected via DI from the composition
 * root — no direct import of core classes.
 *
 * Owner rulings: WRITER-001 through WRITER-004.
 */
import type { Express, Request, Response } from 'express';
import type { ActorRegistry, ElevatedAuthProvider, IdentityClaims, Uuid } from '@nexus/contracts';
import { hasAdminRole, nowIso } from '@nexus/contracts';
import { san } from './shared.js';

// ── ManifestWriter interface (Layer 7 contract for DI) ──────────────────────

export interface ManifestWriter {
  addEntry(
    manifestPath: string,
    arrayKey: string,
    entry: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  updateEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    updates: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  removeEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
}

// ── File lock (WRITER-004) — in-memory, single-process ──────────────────────

interface FileLock {
  readonly adminUserId: string;
  readonly acquiredAt: number;
}

const locks = new Map<string, FileLock>();
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function acquireLock(
  filePath: string,
  adminUserId: string
): { ok: true } | { ok: false; heldBy: string } {
  const existing = locks.get(filePath);
  if (existing) {
    if (existing.adminUserId === adminUserId) {
      locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
      return { ok: true };
    }
    if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
      locks.delete(filePath);
    } else {
      return { ok: false, heldBy: existing.adminUserId };
    }
  }
  locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
  return { ok: true };
}

function releaseLock(filePath: string, adminUserId: string): void {
  const existing = locks.get(filePath);
  if (existing && existing.adminUserId === adminUserId) {
    locks.delete(filePath);
  }
}

function checkLockStatus(filePath: string): FileLock | null {
  const existing = locks.get(filePath);
  if (!existing) return null;
  if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
    locks.delete(filePath);
    return null;
  }
  return existing;
}

const MANIFEST_ENDPOINTS = 'config/nvg/endpoints.v1.yaml';
const MANIFEST_CONNECTORS = 'config/connectors/connectors.v1.yaml';

export interface AdminWriterRouteDeps {
  readonly elevatedAuthProvider?: ElevatedAuthProvider;
  readonly manifestWriter?: ManifestWriter;
  readonly actorRegistry?: ActorRegistry;
}

interface AuthOk {
  readonly ok: true;
  readonly claims: IdentityClaims;
  readonly actorId: string;
  readonly principalId: string;
}
interface AuthFail {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
}

async function checkAdminAuth(
  req: Request,
  res: Response,
  deps: AdminWriterRouteDeps
): Promise<AuthOk | AuthFail> {
  const claims = res.locals['claims'] as IdentityClaims | undefined;
  const actorId = res.locals['actorId'] as string | undefined;
  const principalId = res.locals['principalId'] as string | undefined;
  if (!claims || !actorId || !principalId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!hasAdminRole(claims.roleAssignments))
    return { ok: false, status: 403, error: 'Admin role required' };
  if (!deps.elevatedAuthProvider)
    return { ok: false, status: 403, error: 'Elevated session validator not configured' };
  const elevatedSessionId = req.headers['x-elevated-session'] as string | undefined;
  if (!elevatedSessionId)
    return { ok: false, status: 403, error: 'X-Elevated-Session header required' };
  try {
    const status = await deps.elevatedAuthProvider.validateSession(
      elevatedSessionId as Uuid,
      principalId
    );
    if (!status.valid)
      return { ok: false, status: 403, error: 'Elevated session invalid or expired' };
  } catch {
    return { ok: false, status: 403, error: 'Elevated session validation failed' };
  }
  return { ok: true, claims, actorId, principalId };
}

async function probeEndpointHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

export function registerAdminWriterRoutes(app: Express, deps: AdminWriterRouteDeps): void {
  // ═══ SURFACE 1: Model Endpoints (YAML manifest) ═══
  app.post('/workspace/admin/setup/endpoints', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    const lock = acquireLock(MANIFEST_ENDPOINTS, auth.principalId);
    if (!lock.ok) {
      res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
      return;
    }
    try {
      const entry = req.body;
      if (!entry?.endpointId || !entry?.url || !entry?.adapterId || !entry?.modelName) {
        res
          .status(400)
          .json({ ok: false, error: 'endpointId, url, adapterId, and modelName required' });
        return;
      }
      if (entry.enabled === undefined) entry.enabled = true;
      if (!entry.auth) entry.auth = { kind: 'none' };
      const entries = await deps.manifestWriter.addEntry(
        MANIFEST_ENDPOINTS,
        'endpoints',
        entry,
        'endpointId'
      );
      const healthy = await probeEndpointHealth(entry.url);
      releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
      res.json({
        ok: true,
        data: { endpointId: entry.endpointId, healthy, requiresRestart: true },
      });
    } catch (err) {
      releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  });

  app.put('/workspace/admin/setup/endpoints/:endpointId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    const lock = acquireLock(MANIFEST_ENDPOINTS, auth.principalId);
    if (!lock.ok) {
      res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
      return;
    }
    try {
      const eid = String(req.params['endpointId']);
      const entries = await deps.manifestWriter.updateEntry(
        MANIFEST_ENDPOINTS,
        'endpoints',
        eid,
        req.body,
        'endpointId'
      );
      const updated = entries.find(e => e['endpointId'] === eid);
      const healthy = updated?.['url']
        ? await probeEndpointHealth(String(updated['url']))
        : undefined;
      releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
      res.json({ ok: true, data: { endpointId: eid, healthy, requiresRestart: true } });
    } catch (err) {
      releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  });

  app.delete(
    '/workspace/admin/setup/endpoints/:endpointId',
    async (req: Request, res: Response) => {
      const auth = await checkAdminAuth(req, res, deps);
      if (!auth.ok) {
        res.status(auth.status).json({ ok: false, error: auth.error });
        return;
      }
      if (!deps.manifestWriter) {
        res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
        return;
      }
      const lock = acquireLock(MANIFEST_ENDPOINTS, auth.principalId);
      if (!lock.ok) {
        res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
        return;
      }
      try {
        const eid = String(req.params['endpointId']);
        await deps.manifestWriter.removeEntry(MANIFEST_ENDPOINTS, 'endpoints', eid, 'endpointId');
        releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
        res.json({ ok: true, data: { endpointId: eid, removed: true, requiresRestart: true } });
      } catch (err) {
        releaseLock(MANIFEST_ENDPOINTS, auth.principalId);
        const sc = (err as { statusCode?: number }).statusCode ?? 500;
        res.status(sc).json({ ok: false, error: san(err) });
      }
    }
  );

  // ═══ SURFACE 2: Actors & Agents (SQLite — immediate) ═══
  app.post('/workspace/admin/setup/actors', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.actorRegistry) {
      res.status(501).json({ ok: false, error: 'Actor registry not configured' });
      return;
    }
    try {
      const actor = req.body;
      if (!actor?.actorId || !actor?.actorClass || !actor?.displayName) {
        res.status(400).json({ ok: false, error: 'actorId, actorClass, and displayName required' });
        return;
      }
      if (actor.enabled === undefined) actor.enabled = true;
      if (!actor.registeredAt) actor.registeredAt = nowIso();
      await deps.actorRegistry.register(actor);
      res.json({ ok: true, data: { actorId: actor.actorId, requiresRestart: false } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.put('/workspace/admin/setup/actors/:actorId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.actorRegistry) {
      res.status(501).json({ ok: false, error: 'Actor registry not configured' });
      return;
    }
    try {
      const actorId = String(req.params['actorId']);
      const existing = await deps.actorRegistry.get(actorId as Uuid);
      if (!existing) {
        res.status(404).json({ ok: false, error: 'Actor ' + actorId + ' not found' });
        return;
      }
      await deps.actorRegistry.update(actorId as Uuid, {
        ...existing,
        ...req.body,
        actorId: existing.actorId,
      });
      res.json({ ok: true, data: { actorId, requiresRestart: false } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.delete('/workspace/admin/setup/actors/:actorId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.actorRegistry) {
      res.status(501).json({ ok: false, error: 'Actor registry not configured' });
      return;
    }
    try {
      const actorId = String(req.params['actorId']);
      const existing = await deps.actorRegistry.get(actorId as Uuid);
      if (!existing) {
        res.status(404).json({ ok: false, error: 'Actor ' + actorId + ' not found' });
        return;
      }
      await deps.actorRegistry.delete(actorId as Uuid);
      res.json({ ok: true, data: { actorId, deleted: true, requiresRestart: false } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══ SURFACE 3: Connectors (YAML manifest) ═══
  app.post('/workspace/admin/setup/connectors', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    const lock = acquireLock(MANIFEST_CONNECTORS, auth.principalId);
    if (!lock.ok) {
      res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
      return;
    }
    try {
      const entry = req.body;
      if (!entry?.connectorId || !entry?.connectorType) {
        res.status(400).json({ ok: false, error: 'connectorId and connectorType required' });
        return;
      }
      if (entry.enabled === undefined) entry.enabled = true;
      if (!entry.allowedSystems) entry.allowedSystems = ['*'];
      if (!entry.configuration) entry.configuration = {};
      const entries = await deps.manifestWriter.addEntry(
        MANIFEST_CONNECTORS,
        'connectors',
        entry,
        'connectorId'
      );
      releaseLock(MANIFEST_CONNECTORS, auth.principalId);
      res.json({ ok: true, data: { connectorId: entry.connectorId, requiresRestart: true } });
    } catch (err) {
      releaseLock(MANIFEST_CONNECTORS, auth.principalId);
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  });

  app.put('/workspace/admin/setup/connectors/:connectorId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    const lock = acquireLock(MANIFEST_CONNECTORS, auth.principalId);
    if (!lock.ok) {
      res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
      return;
    }
    try {
      const cid = String(req.params['connectorId']);
      await deps.manifestWriter.updateEntry(
        MANIFEST_CONNECTORS,
        'connectors',
        cid,
        req.body,
        'connectorId'
      );
      releaseLock(MANIFEST_CONNECTORS, auth.principalId);
      res.json({ ok: true, data: { connectorId: cid, requiresRestart: true } });
    } catch (err) {
      releaseLock(MANIFEST_CONNECTORS, auth.principalId);
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  });

  app.delete(
    '/workspace/admin/setup/connectors/:connectorId',
    async (req: Request, res: Response) => {
      const auth = await checkAdminAuth(req, res, deps);
      if (!auth.ok) {
        res.status(auth.status).json({ ok: false, error: auth.error });
        return;
      }
      if (!deps.manifestWriter) {
        res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
        return;
      }
      const lock = acquireLock(MANIFEST_CONNECTORS, auth.principalId);
      if (!lock.ok) {
        res.status(423).json({ ok: false, error: 'Manifest locked by ' + lock.heldBy });
        return;
      }
      try {
        const cid = String(req.params['connectorId']);
        await deps.manifestWriter.removeEntry(
          MANIFEST_CONNECTORS,
          'connectors',
          cid,
          'connectorId'
        );
        releaseLock(MANIFEST_CONNECTORS, auth.principalId);
        res.json({ ok: true, data: { connectorId: cid, removed: true, requiresRestart: true } });
      } catch (err) {
        releaseLock(MANIFEST_CONNECTORS, auth.principalId);
        const sc = (err as { statusCode?: number }).statusCode ?? 500;
        res.status(sc).json({ ok: false, error: san(err) });
      }
    }
  );

  // ═══ LOCK STATUS ═══
  app.get('/workspace/admin/setup/lock/:surface', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    const surface = String(req.params['surface']);
    const filePath =
      surface === 'endpoints'
        ? MANIFEST_ENDPOINTS
        : surface === 'connectors'
          ? MANIFEST_CONNECTORS
          : null;
    if (!filePath) {
      res.json({ ok: true, data: { locked: false, surface } });
      return;
    }
    const lock = checkLockStatus(filePath);
    res.json({
      ok: true,
      data: { locked: lock !== null, surface, ...(lock ? { heldBy: lock.adminUserId } : {}) },
    });
  });
}
