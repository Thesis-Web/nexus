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
} from '@nexus/core';
import { createApiServer, type ApiDependencies } from '@nexus/api';
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
  >
>;

export interface WorkspaceBootstrapCoreDeps {
  approvalStore: ApiDependencies['approvalStore'];
  decideApproval: ApiDependencies['decideApproval'];
  loadApproverKey: (principalId: string) => Promise<string | null>;
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
    runLedgerWriter: new JsonlRunLedgerWriter(runLedgerPath),
    loadModeConfig: () => loadModeConfig(modeConfigPath),
    saveModeConfig: config => saveModeConfig(config, modeConfigPath),
    nvgService: opts.createNvgService(),
    trailReader: opts.createTrailReader(path.join(process.cwd(), 'runs')),
    loadNvgRoutingPolicy: () =>
      opts.loadNvgRoutingPolicy(
        path.join(process.cwd(), 'fixtures', 'nvg', 'default.routing-policy.yaml')
      ),
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
