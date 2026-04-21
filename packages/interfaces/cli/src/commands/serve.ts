/**
 * nexus serve — spec §22.1, §23.1
 * Start Management API server with DI.
 * Constructs core service implementations and injects into API server.
 * CLI has RAT-003 exception to import core engine entry points.
 *
 * §9.2: Mode configuration signature validated at startup.
 * Invalid or missing mode config → refuse to start.
 */
import path from 'node:path';
import {
  loadAdminToken,
  loadControlPlaneKey,
  SqliteActorRegistry,
  SqlitePrincipalRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  SqlitePendingApprovalStore,
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
import { NvgServiceImpl, JsonlRoutingTrailReader } from '@nexus/vanguard';
import { openDb } from '../db.js';

export async function cmdServe(opts: { port?: number }): Promise<void> {
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
  // Invalid or missing signature prevents engine start.
  try {
    await loadModeConfig(modeConfigPath);
  } catch (err) {
    console.error(`✗ Mode configuration invalid or missing: ${(err as Error).message}`);
    console.error('  Run `nexus init` to create a valid mode configuration.');
    process.exit(1);
  }

  const deps: ApiDependencies = {
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
    nvgService: new NvgServiceImpl(),
    trailReader: new JsonlRoutingTrailReader(path.join(process.cwd(), 'runs')),
  };

  const { start } = createApiServer(deps);
  const port = opts.port ?? 7701;
  console.log(`DB: ${process.env['NEXUS_DB_PATH'] ?? 'nexus.db'}`);
  start(port);
}
