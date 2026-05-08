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
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type {
  ActorRegistry,
  ElevatedAuthProvider,
  IdentityClaims,
  PrincipalRegistry,
  RunLedgerWriter,
  Uuid,
} from '@nexus/contracts';
import {
  ACTOR_CLASS,
  CAPABILITY_IDS,
  MODEL_TIER,
  OCT_CEILINGS,
  OCT_LEVEL,
  RISK_TIER,
  RISK_TIER_ORDER,
  hasAdminRole,
  nowIso,
} from '@nexus/contracts';
import { san } from './shared.js';

// ── ManifestWriter interface (Layer 7 contract for DI) ──────────────────────

export interface ManifestWriter {
  /** Read raw manifest entries (ALL entries, including disabled). */
  readEntries(manifestPath: string, arrayKey: string): Promise<Record<string, unknown>[]>;
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

// ── SecretWriter interface — admin secret onboarding ──────────────────────
//
// Layer 7 cannot import the FileSecretSource directly (Layer 3). Bootstrap
// constructs a FileSecretSource and adapts it to this minimal write+presence
// surface so the admin secret routes never touch values they don't own.
//
// NEVER add a "readSecret" method here. Status routes return presence, not
// value (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC §"WHAT'S FORBIDDEN").

export interface SecretWriter {
  /** Write a key. Throws on invalid input or unrecoverable backend errors. */
  writeSecret(keyName: string, keyValue: string): Promise<void>;
  /** Delete a key. Returns true if a key was removed. */
  deleteSecret(keyName: string): Promise<boolean>;
  /** List stored key names — names ONLY, never values. */
  listKeyNames(): Promise<readonly string[]>;
  /** Backing storage label for evidence display (e.g. "keys/secrets.json"). */
  readonly storageLabel: string;
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
  /** Registered principals — used by the catalog route for the principalId dropdown. */
  readonly principalRegistry?: PrincipalRegistry;
  /**
   * Admin secret store (file-backed). When omitted, the secret routes return
   * 501 — the rest of the writer surface keeps working.
   */
  readonly secretWriter?: SecretWriter;
  /**
   * Run ledger writer for credential-lifecycle audit events
   * (`secret_stored` / `secret_removed`). When omitted, secret writes still
   * succeed but no audit entry is emitted — operators in production should
   * treat that as a misconfiguration. Same shape as templates.ts wiring.
   */
  readonly runLedgerWriter?: RunLedgerWriter;
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

/**
 * Emit a credential-lifecycle audit entry to the run ledger.
 *
 * CLAUDE-CODE-SECRET-MANAGEMENT-SPEC §"WHAT'S FORBIDDEN":
 *   - detail.keyName is the ONLY identity field — never the value, never a
 *     hash, never a length, never a prefix.
 *   - actorId + principalId capture WHO took the action (admin auth chain).
 *   - storageLabel captures WHICH backend (file vs vault in production).
 *   - adminOperation: true matches the templates.ts convention so audit
 *     consumers can filter admin-lifecycle entries from run-scoped activity.
 *
 * Best-effort: a ledger backend failure must not roll back a successful
 * key write/delete (the credential state on disk has already changed).
 * We log a warning so missing audit entries are visible to operators, who
 * can detect them via gap-detection on the secret_stored / secret_removed
 * counters.
 *
 * No runLedgerWriter wired → silent no-op. Production should treat that
 * as a misconfiguration; reference deployments may legitimately omit it.
 */
async function emitSecretAuditEvent(
  deps: AdminWriterRouteDeps,
  eventType: 'secret_stored' | 'secret_removed',
  detail: {
    keyName: string;
    actorId: string;
    principalId: string;
    storageLabel: string;
  }
): Promise<void> {
  if (!deps.runLedgerWriter) return;
  try {
    await deps.runLedgerWriter.writeEvent({
      runId: randomUUID() as Uuid,
      eventType,
      timestamp: nowIso(),
      actorId: detail.actorId as Uuid,
      detail: {
        adminOperation: true,
        keyName: detail.keyName,
        principalId: detail.principalId,
        storageLabel: detail.storageLabel,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[admin-writer] failed to emit ${eventType} audit event for key ${detail.keyName}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
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

  // ═══ CATALOG (governed constants + raw manifest entries) ═══
  // SPEC-ADMIN-CATALOG-EDITABLE-FORMS §3 — drives every dynamic dropdown in the
  // admin dashboard. Reads constants from @nexus/contracts (Layer 2) and raw
  // manifest entries via the injected ManifestWriter (already on disk).
  app.get('/workspace/admin/setup/catalog', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    try {
      const actorClasses = Object.values(ACTOR_CLASS).map(id => ({ id, label: id }));
      const octLevels = Object.values(OCT_LEVEL).map(id => {
        const ceiling = OCT_CEILINGS[id];
        return {
          id,
          label: id,
          actionRiskCeiling: ceiling?.actionRiskCeiling ?? '',
          modelTierCeiling: ceiling?.modelTierCeiling ?? [],
          dataClassCeiling: ceiling?.dataClassCeiling ?? [],
        };
      });
      const riskTiers = Object.values(RISK_TIER).map(id => ({
        id,
        label: id,
        order: RISK_TIER_ORDER.indexOf(id),
      }));
      const modelTiers = Object.values(MODEL_TIER).map(id => ({ id, label: id }));
      const capabilityIds = Object.values(CAPABILITY_IDS);
      const authKinds = [
        { id: 'none', label: 'none', requiresSecret: false },
        { id: 'api_key', label: 'api_key', requiresSecret: true },
        { id: 'bearer', label: 'bearer', requiresSecret: true },
      ];
      const [allEndpoints, allConnectors, allActors, principals] = await Promise.all([
        deps.manifestWriter.readEntries(MANIFEST_ENDPOINTS, 'endpoints'),
        deps.manifestWriter
          .readEntries(MANIFEST_CONNECTORS, 'connectors')
          .catch(() => [] as Record<string, unknown>[]),
        deps.actorRegistry ? deps.actorRegistry.list() : Promise.resolve([]),
        deps.principalRegistry ? deps.principalRegistry.list() : Promise.resolve([]),
      ]);
      res.json({
        ok: true,
        data: {
          actorClasses,
          octLevels,
          riskTiers,
          modelTiers,
          capabilityIds,
          authKinds,
          allEndpoints,
          allConnectors,
          allActors,
          principals,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══ DISCOVER (probe ollama node for available models) ═══
  // POST { baseUrl, adapterId? } → GET {baseUrl}/api/tags → return models[].
  // Used by the admin "Add endpoint" form to populate a model dropdown after
  // the admin enters a node URL.
  app.post('/workspace/admin/setup/discover', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    const baseUrlRaw = req.body?.baseUrl;
    if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
      res.status(400).json({ ok: false, error: 'baseUrl required' });
      return;
    }
    let probeUrl: URL;
    try {
      probeUrl = new URL(baseUrlRaw);
    } catch {
      res.status(400).json({ ok: false, error: 'baseUrl must be a valid URL' });
      return;
    }
    if (probeUrl.protocol !== 'http:' && probeUrl.protocol !== 'https:') {
      res.status(400).json({ ok: false, error: 'baseUrl must be http or https' });
      return;
    }
    // Strip trailing path components — admin may paste either the bare host or
    // the full /api/chat URL. We always probe /api/tags on the origin.
    const tagsUrl = new URL('/api/tags', probeUrl.origin).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const probe = await fetch(tagsUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!probe.ok) {
        res.status(502).json({
          ok: false,
          error: `Probe failed: HTTP ${probe.status} from ${tagsUrl}`,
        });
        return;
      }
      const body = (await probe.json()) as { models?: Array<Record<string, unknown>> };
      const models = Array.isArray(body?.models) ? body.models : [];
      res.json({
        ok: true,
        data: {
          probedUrl: tagsUrl,
          models: models.map(m => ({
            name: typeof m['name'] === 'string' ? m['name'] : String(m['name'] ?? ''),
            model: typeof m['model'] === 'string' ? m['model'] : undefined,
            size: typeof m['size'] === 'number' ? m['size'] : undefined,
            modifiedAt: typeof m['modified_at'] === 'string' ? m['modified_at'] : undefined,
          })),
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg =
        (err as { name?: string }).name === 'AbortError'
          ? `Probe timed out after 5s: ${tagsUrl}`
          : san(err);
      res.status(502).json({ ok: false, error: msg });
    }
  });

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

  // ═══ SURFACE 4: Admin secret onboarding ═══
  // CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — operators paste API keys directly
  // from the dashboard. Keys are persisted to keys/secrets.json (gitignored)
  // and then resolved at invoke-time via the chained SecretSource. Status
  // returns presence + source per key, NEVER values.
  //
  // Auth posture matches the rest of admin-writer (JWT + nexus-admin role +
  // X-Elevated-Session). Forbidden surfaces (per spec):
  //   - never echo the key back in any response
  //   - never log the key
  //   - never persist it in SQLite, the manifest YAML, or git
  //
  // KEY_NAME validation: upper-snake-case, max 128 chars. Anything else is
  // rejected so a stray colon or path separator can't smuggle a foreign
  // identifier into the file map.
  const KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
  const MAX_KEY_NAME_LEN = 128;
  const MAX_KEY_VALUE_LEN = 8 * 1024; // 8 KiB — well above any provider key

  app.post('/workspace/admin/setup/secrets', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.secretWriter) {
      res.status(501).json({ ok: false, error: 'Secret writer not configured' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const keyName = typeof body['keyName'] === 'string' ? body['keyName'] : '';
    const keyValue = typeof body['keyValue'] === 'string' ? body['keyValue'] : '';
    if (!keyName || keyName.length > MAX_KEY_NAME_LEN || !KEY_NAME_RE.test(keyName)) {
      res.status(400).json({
        ok: false,
        error: 'keyName must be upper-snake-case ([A-Z][A-Z0-9_]*) and ≤128 chars',
      });
      return;
    }
    if (!keyValue || keyValue.length > MAX_KEY_VALUE_LEN) {
      res.status(400).json({
        ok: false,
        error: `keyValue required (non-empty, ≤${MAX_KEY_VALUE_LEN} chars)`,
      });
      return;
    }
    try {
      await deps.secretWriter.writeSecret(keyName, keyValue);
      // Audit: credential-lifecycle event. Detail carries keyName + actor +
      // storageLabel ONLY — never the value, never a hash, never a length.
      // Synthetic per-operation runId mirrors templates.ts adminOperation.
      // Best-effort: a ledger failure must not roll back a stored key, so
      // we log and continue. Operators can detect missing audit entries via
      // the gap-detection gate (CMP-12 style).
      await emitSecretAuditEvent(deps, 'secret_stored', {
        keyName,
        actorId: auth.actorId,
        principalId: auth.principalId,
        storageLabel: deps.secretWriter.storageLabel,
      });
      // Response is intentionally write-only — keyName + stored=true. No value echo.
      res.json({
        ok: true,
        data: {
          keyName,
          stored: true,
          source: 'file',
          storageLabel: deps.secretWriter.storageLabel,
        },
      });
    } catch (err) {
      // Don't leak the key value via the error message either — sanitizer
      // already handles strings, but keyValue isn't in the error path.
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.delete('/workspace/admin/setup/secrets/:keyName', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.secretWriter) {
      res.status(501).json({ ok: false, error: 'Secret writer not configured' });
      return;
    }
    const keyName = String(req.params['keyName'] ?? '');
    if (!keyName || keyName.length > MAX_KEY_NAME_LEN || !KEY_NAME_RE.test(keyName)) {
      res.status(400).json({
        ok: false,
        error: 'keyName must be upper-snake-case ([A-Z][A-Z0-9_]*) and ≤128 chars',
      });
      return;
    }
    try {
      const removed = await deps.secretWriter.deleteSecret(keyName);
      // Audit only on actual removal — a no-op delete (key already absent)
      // doesn't change credential state, so we don't pollute the ledger
      // with non-events. Same keyName-only detail as secret_stored.
      if (removed) {
        await emitSecretAuditEvent(deps, 'secret_removed', {
          keyName,
          actorId: auth.actorId,
          principalId: auth.principalId,
          storageLabel: deps.secretWriter.storageLabel,
        });
      }
      res.json({ ok: true, data: { keyName, removed } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/setup/secrets/status', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    // Always returns presence + source; NEVER values. Works without
    // secretWriter, in which case we report only the env-side picture.
    const fileNames = deps.secretWriter ? await deps.secretWriter.listKeyNames() : [];
    const fileSet = new Set(fileNames);

    // The well-known provider keys are the ones the form pre-suggests.
    // We surface their status even when the operator hasn't stored a key yet,
    // so the dashboard can render the amber "Key required" indicator.
    const KNOWN_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;
    const seen = new Set<string>([...KNOWN_KEYS, ...fileSet]);

    const keys: Array<{
      keyName: string;
      present: boolean;
      source: 'file' | 'env' | null;
    }> = [];
    for (const name of seen) {
      if (fileSet.has(name)) {
        keys.push({ keyName: name, present: true, source: 'file' });
        continue;
      }
      const envValue = process.env[name];
      if (typeof envValue === 'string' && envValue.length > 0) {
        keys.push({ keyName: name, present: true, source: 'env' });
        continue;
      }
      keys.push({ keyName: name, present: false, source: null });
    }
    keys.sort((a, b) => a.keyName.localeCompare(b.keyName));

    res.json({
      ok: true,
      data: {
        keys,
        storageLabel: deps.secretWriter?.storageLabel ?? null,
      },
    });
  });
}
