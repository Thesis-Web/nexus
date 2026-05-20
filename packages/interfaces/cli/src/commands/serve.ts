/**
 * nexus serve — spec §22.1, §23.1
 * Start Management API server with DI.
 * Constructs core service implementations and injects into API server.
 * CLI has RAT-003 exception to import core engine entry points (Layer 1).
 *
 * MODULAR-S29-002 fix: NVG service construction removed from this file.
 * NVG factories are injected from the composition root via ServeOptions.
 *
 * §9.2: Mode configuration signature validated at startup.
 * Invalid or missing mode config → refuse to start.
 */
import path from 'node:path';
import type { NvgService, NvgRoutingPolicy, RoutingTrailReader, NonEmpty } from '@nexus/contracts';
import {
  loadAdminToken,
  loadControlPlaneKey,
  SqliteActorRegistry,
  SqlitePrincipalRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  SqlitePendingApprovalStore,
  SqliteApproverRegistry,
  JsonlLedgerBackend,
  JsonlRunLedgerWriter,
  mintRootDelegation,
  loadPolicyFile,
  verifyChain,
  decideApproval,
  loadModeConfig,
  saveModeConfig,
  changeMode,
  disableEnforcingLock,
  sign as signEd25519,
  canonicalize,
  ManifestWriterService,
} from '@nexus/core';
import { promises as fsPromises } from 'node:fs';
import * as fsPath from 'node:path';
import { createHash } from 'node:crypto';
import type { ModeSigner, ModeSignerState } from '@nexus/api';
import { createApiServer, wrapWriterWithFanout, type ApiDependencies } from '@nexus/api';
// ── WS-BOOTSTRAP type seam ──────────────────────────────────────────────────
export type WorkspaceApiDeps = Partial<
  Pick<
    ApiDependencies,
    | 'identityProvider'
    | 'workspaceSessionStore'
    | 'workspaceRunAclStore'
    | 'workspaceEventTicketStore'
    | 'workspaceFileStore'
    | 'workspaceBlobStore'
    | 'workspaceApprovalBridge'
    | 'promptTemplateStore'
    | 'secureRailStore'
    | 'elevatedAuthProvider'
    | 'catalogReader'
    | 'adminSignerRegistry'
    | 'verifySignature'
    | 'workspaceJwtSecret'
    | 'workspaceSockets'
    | 'computeDigest'
    | 'dispatchToOrchestrator'
    | 'orchestrator'
    | 'orchestratorSockets'
    | 'pipelineInterface'
    // CLAUDE-CODE-NXS-WIRE-PHASE-B — runtime NXS dispatch.
    | 'dispatchToNxs'
    // CLAUDE-CODE-ADMIN-PANELS-PHASE-D — connector caps + policy summary.
    | 'connectorCapabilities'
    | 'nxsPolicySummary'
    // ── Claude C / SPEC-addendum-beta1-admin-dashboard §3.2 ──
    // Manifest records flow through to admin-setup projection routes.
    | 'identityRecords'
    | 'connectorRecords'
    | 'channelRecords'
    | 'mailboxRecords'
    | 'compilerRecords'
    | 'compileReturnRecords'
    | 'endpoints'
    // ── E2E wiring: prompt → NVG → mailbox → compile → return ──
    // Composition root threads bootstrap-owned services through so the
    // workspace `dispatch` and `triggerCompile` paths can call the real
    // engines and the compile-return route can verify signed callbacks.
    | 'nvgService'
    | 'mailboxService'
    | 'outputCollector'
    | 'compileService'
    | 'getDefaultCompiler'
    | 'getPrimaryMailbox'
    | 'resolveReturnEndpointForRun'
    | 'dispatchCompileReturn'
    | 'getReturnEndpoint'
    | 'verifyCallbackSignature'
    | 'verifyArtifactSignature'
    | 'recomputeArtifactDigest'
    | 'controlPlanePublicKey'
    | 'resolveArtifactBody'
    | 'resolvePendingCheckback'
    // ── CLAUDE-CODE-SECRET-MANAGEMENT-SPEC ──
    // Admin secret onboarding port. Bootstrap supplies a FileSecretSource
    // adapter so admin-writer routes can persist API keys without giving
    // Layer 7 a read-side handle on the values.
    | 'secretWriter'
  >
>;

export interface WorkspaceBootstrapCoreDeps {
  approvalStore: ApiDependencies['approvalStore'];
  decideApproval: ApiDependencies['decideApproval'];
  loadApproverKey: (principalId: string) => Promise<string | null>;
  // ORCH-WIRE-001: canonical stores for actor unification + orchestrator wiring
  actorRegistry: ApiDependencies['actorRegistry'];
  principalRegistry: ApiDependencies['principalRegistry'];
  // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX: real session store for IdentityGate +
  // dispatchToGovernance to create real per-run sessions (was a stub returning null).
  sessionStore: ApiDependencies['sessionStore'];
  delegationStore: ApiDependencies['delegationStore'];
  ledgerBackend: ApiDependencies['ledgerBackend'];
  runLedgerWriter: ApiDependencies['runLedgerWriter'];
  db: import('better-sqlite3').Database;
}

import { openDb } from '../db.js';

export interface ServeOptions {
  port?: number;
  /** NVG service factory — injected from composition root (scripts/nexus-main.ts) */
  createNvgService: () => NvgService;
  /** Trail reader factory — injected from composition root */
  createTrailReader: (dir?: string) => RoutingTrailReader;
  /** NVG routing policy loader — injected from composition root */
  loadNvgRoutingPolicy: (filepath: string) => Promise<NvgRoutingPolicy>;
  /**
   * WS-BOOTSTRAP: workspace deps factory — injected from composition root.
   * All @nexus/workspace-ref construction happens there, not here.
   * Takes 3 core deps because bridge shares core's PendingApprovalStore.
   */
  bootstrapWorkspaceApiDeps?: (coreDeps: WorkspaceBootstrapCoreDeps) => Promise<WorkspaceApiDeps>;
}

export async function cmdServe(opts: ServeOptions): Promise<void> {
  let adminToken: string;
  try {
    adminToken = await loadAdminToken();
  } catch {
    console.error('✗ keys/admin.token not found. Run `nexus init` first.');
    process.exit(1);
  }

  const controlPlaneKey = await loadControlPlaneKey();
  const db = openDb();

  const ledgerPath =
    process.env['NEXUS_LEDGER_PATH'] ?? path.join(process.cwd(), 'nexus.ledger.jsonl');

  const runLedgerPath =
    process.env['NEXUS_RUN_LEDGER_PATH'] ??
    path.join(process.cwd(), 'runs', 'infra.run-ledger.jsonl');

  const modeConfigPath = path.join(process.cwd(), 'keys', 'mode-config.json');

  // §9.2: Validate mode configuration signature at startup.
  try {
    await loadModeConfig(modeConfigPath);
  } catch (err) {
    console.error(`✗ Mode configuration invalid or missing: ${(err as Error).message}`);
    console.error('  Run `nexus init` to create a valid mode configuration.');
    process.exit(1);
  }

  // ── SPEC-ADMIN-WRITER §3: Manifest writer for admin dashboard mutations ──
  const manifestWriter = new ManifestWriterService({
    privateKey: controlPlaneKey.privateKey,
    issuer: 'nexus-dev',
  });

  // ── AMEND-nexus-admin-dashboard-full-buildout §3.6: ModeSigner ───────────
  // File-backed implementation: loads the admin's signing keypair from
  // keys/admins/<principalId>.keypair.json, invokes core's changeMode /
  // disableEnforcingLock, and saves the new envelope. Used by the dashboard
  // POST /workspace/admin/setup/mode + /mode/unlock routes.
  const keyDirectory = fsPath.join(process.cwd(), 'keys');
  const adminKeypairPath = (principalId: string): string =>
    fsPath.join(keyDirectory, 'admins', `${principalId}.keypair.json`);
  async function loadAdminKeypair(
    principalId: string
  ): Promise<{ publicKey: string; privateKey: string } | null> {
    try {
      const raw = await fsPromises.readFile(adminKeypairPath(principalId), 'utf-8');
      const parsed = JSON.parse(raw) as { publicKey?: string; privateKey?: string };
      if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
        return null;
      }
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    } catch {
      return null;
    }
  }
  function fingerprintSignature(signature: string): string {
    const h = createHash('sha256').update(signature).digest('base64url');
    return `sha256:${h.slice(0, 24)}`;
  }
  const runLedgerWriterShared = wrapWriterWithFanout(new JsonlRunLedgerWriter(runLedgerPath));
  const modeSigner: ModeSigner = {
    async hasSigningKeypair(adminPrincipalId: string): Promise<boolean> {
      const kp = await loadAdminKeypair(adminPrincipalId);
      return kp !== null;
    },
    async loadCurrentState(): Promise<ModeSignerState> {
      const cfg = await loadModeConfig(modeConfigPath);
      return {
        nxsMode: cfg.nxsMode as ModeSignerState['nxsMode'],
        nvgMode: cfg.nvgMode as ModeSignerState['nvgMode'],
        enforcingLocked: cfg.enforcingLocked,
        updatedAt: cfg.updatedAt,
        updatedBy: {
          adminId: cfg.updatedBy.adminId,
          publicKey: cfg.updatedBy.publicKey,
        },
        signatureFingerprint: fingerprintSignature(cfg.signature),
      };
    },
    async changeMode({ engine, mode, adminPrincipalId }) {
      const kp = await loadAdminKeypair(adminPrincipalId);
      if (!kp) {
        throw Object.assign(new Error('admin signing keypair missing'), { statusCode: 412 });
      }
      const current = await loadModeConfig(modeConfigPath);
      const next = await changeMode(
        engine,
        mode,
        adminPrincipalId as unknown as NonEmpty,
        kp as unknown as Parameters<typeof changeMode>[3],
        current,
        runLedgerWriterShared
      );
      await saveModeConfig(next, modeConfigPath);
      return {
        nxsMode: next.nxsMode as ModeSignerState['nxsMode'],
        nvgMode: next.nvgMode as ModeSignerState['nvgMode'],
        enforcingLocked: next.enforcingLocked,
        updatedAt: next.updatedAt,
        updatedBy: {
          adminId: next.updatedBy.adminId,
          publicKey: next.updatedBy.publicKey,
        },
        signatureFingerprint: fingerprintSignature(next.signature),
      };
    },
    async unlockEnforcing(_adminPrincipalId): Promise<ModeSignerState> {
      // F4.17 / Q4 / HL #10 — the previous minRequired=1 single-admin
      // dashboard unlock is retired. The lawful path is SigningCouncil
      // 2-of-2 with operation='mode_unlock' (Spec F4.1); plug-in side
      // rejects single-admin attempts with 409 until SigningCouncil
      // ratifies. Until Patch 6 lands SigningCouncil end-to-end, no
      // dashboard unlock path exists; CLI multi-party flow continues
      // to work via disableEnforcingLock with ≥2 admin signatures.
      throw Object.assign(
        new Error(
          'unlock_requires_two_distinct_admins — open a SigningCouncil mode_unlock request (Spec F4.1)'
        ),
        { statusCode: 409 }
      );
    },
  };

  const baseDeps: ApiDependencies = {
    actorRegistry: new SqliteActorRegistry(db),
    principalRegistry: new SqlitePrincipalRegistry(db),
    sessionStore: new SqliteSessionStore(db),
    delegationStore: new SqliteDelegationStore(db),
    approvalStore: new SqlitePendingApprovalStore(db),
    ledgerBackend: new JsonlLedgerBackend(ledgerPath),
    mintRootDelegation,
    loadPolicyFile: (filepath: string) => loadPolicyFile(filepath, controlPlaneKey),
    verifyChain: (backend, from, to) => verifyChain(backend, from, to, controlPlaneKey.publicKey),
    decideApproval,
    adminToken,
    // Wrap so every workspace + orchestrator-coordinator writeEvent fans
    // out to any open SSE subscriber for that runId.
    runLedgerWriter: runLedgerWriterShared,
    loadModeConfig: () => loadModeConfig(modeConfigPath),
    saveModeConfig: config => saveModeConfig(config, modeConfigPath),
    nvgService: opts.createNvgService(),
    trailReader: opts.createTrailReader(path.join(process.cwd(), 'runs')),
    loadNvgRoutingPolicy: () =>
      opts.loadNvgRoutingPolicy(
        path.join(process.cwd(), 'fixtures', 'nvg', 'default.routing-policy.yaml')
      ),
    manifestWriter,
    modeSigner,
    keyDirectory,
    // §4.1 — best-effort: report any admin signing keypair as present.
    // The dashboard panel uses this to show the fallback CLI-instructions
    // block when missing; per-principal checking happens inside ModeSigner.
    hasAdminSigningKeypair: async () => {
      try {
        const dir = fsPath.join(keyDirectory, 'admins');
        const files = await fsPromises.readdir(dir);
        return files.some(f => f.endsWith('.keypair.json'));
      } catch {
        return false;
      }
    },
  };

  let workspaceApiDeps: WorkspaceApiDeps = {};
  if (opts.bootstrapWorkspaceApiDeps) {
    const approverRegistry = new SqliteApproverRegistry(db);
    const loadApproverKey = async (principalId: string): Promise<string | null> => {
      const key = await approverRegistry.getPublicKey(principalId as NonEmpty);
      return key !== null ? principalId : null;
    };
    workspaceApiDeps = await opts.bootstrapWorkspaceApiDeps({
      approvalStore: baseDeps.approvalStore,
      decideApproval,
      loadApproverKey,
      actorRegistry: baseDeps.actorRegistry,
      principalRegistry: baseDeps.principalRegistry,
      sessionStore: baseDeps.sessionStore,
      delegationStore: baseDeps.delegationStore,
      ledgerBackend: baseDeps.ledgerBackend,
      runLedgerWriter: baseDeps.runLedgerWriter,
      db,
    });
    console.log('[serve] Workspace deps resolved');
  }

  const deps: ApiDependencies = {
    ...baseDeps,
    ...workspaceApiDeps,
  };

  const { start } = createApiServer(deps);
  const port = opts.port ?? 7701;
  console.log(`DB: ${process.env['NEXUS_DB_PATH'] ?? 'nexus.db'}`);
  start(port);
}
