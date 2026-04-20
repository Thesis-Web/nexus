/**
 * nexus serve — spec §22.1, §23.1
 * Start Management API server with DI.
 * Constructs core service implementations and injects into API server.
 * CLI has RAT-003 exception to import core engine entry points.
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
  mintRootDelegation,
  loadPolicyFile,
  verifyChain,
  decideApproval,
} from '@nexus/core';
import { createApiServer, type ApiDependencies } from '@nexus/api';
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
  };

  const { start } = createApiServer(deps);
  const port = opts.port ?? 7701;
  console.log(`DB: ${process.env['NEXUS_DB_PATH'] ?? 'nexus.db'}`);
  start(port);
}
