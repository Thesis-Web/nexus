/**
 * nexus serve-mcp — DEF-025 (DIFF-S6-002 Option A)
 * Start MCP proxy HTTP server with full DI.
 *
 * Moves composition-root logic from scripts/mcp-server.ts into Layer 7 CLI.
 * Layer 7 may import @nexus/core entry points (RAT-003 exception).
 * @nexus/adapter-mcp depends on @nexus/contracts only — safe to import here.
 *
 * DEVIATION LOG:
 *   spec §6.1 pins mcp-server.ts at packages/adapters/mcp/src/
 *   spec §6.2 pins "nexus:mcp" script to that path
 *   Both remain stale until canon is amended.
 *   Approved repair: this CLI command replaces the scripts/ composition root.
 *
 * Spec: §19.1, §19.2
 * Blueprint: §24.5, §24.8
 */
import * as http from 'node:http';
import * as path from 'node:path';

import {
  loadControlPlaneKey,
  SqliteActorRegistry,
  SqlitePrincipalRegistry,
  SqliteApproverRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  SqlitePendingApprovalStore,
  JsonlLedgerBackend,
  JsonlRunLedgerWriter,
  ReferenceClaimVerifier,
  VerbNormalizer,
  LexicalVerbResolver,
  TargetNormalizer,
  CapabilityRegistry,
  DataClassifier,
  RiskClassifier,
  IdentityGate,
  RegistryBackedIdentityProvider,
  ClassificationGate,
  DelegationGate,
  PolicyGate,
  ApprovalGate,
  ExecutionGate,
  EvidenceGate,
  Pipeline,
  SimpleConnectorRegistry,
  SimpleChannelRegistry,
  CliApprovalChannel,
  ReplayDetector,
  RateLimiter,
  loadPolicyFile,
  loadModeConfig,
} from '@nexus/core';

import type { ConnectorRegistry } from '@nexus/contracts';
import { McpAdapter, NexusMcpProxy } from '@nexus/adapter-mcp';
import { openDb } from '../db.js';

export interface ServeMcpOptions {
  port?: number;
  host?: string;
  /** Connector registry factory — injected from composition root */
  createConnectorRegistry: () => ConnectorRegistry;
}

export async function cmdServeMcp(opts: ServeMcpOptions): Promise<void> {
  const repoRoot = process.cwd();
  const PORT = opts.port ?? parseInt(process.env['NEXUS_MCP_PORT'] ?? '4000', 10);
  const HOST = opts.host ?? process.env['NEXUS_MCP_HOST'] ?? '127.0.0.1';
  const LEDGER_PATH = process.env['NEXUS_LEDGER_PATH'] ?? path.join(repoRoot, 'nexus.ledger.jsonl');
  const POLICY_PATH =
    process.env['NEXUS_POLICY_PATH'] ??
    path.join(repoRoot, 'packages/core/src/policy/rules/default.policy.json');

  console.log('[nexus:mcp] starting...');
  console.log(`[nexus:mcp] listen:  http://${HOST}:${PORT}`);

  // 1. Database
  const db = openDb();

  // 2. Crypto — control-plane keypair
  const controlPlaneKey = await loadControlPlaneKey();
  // MODE-001: Load signed mode config at startup
  const modeConfig = await loadModeConfig();

  // 3. Ledger backend (JSONL — Backend v1)
  const ledger = new JsonlLedgerBackend(LEDGER_PATH);
  // 3b. Run-event ledger sibling of `ledger` — F4.9 / Hard Law #14
  // claim-drift verification writes `claim_drift_detected` events here.
  const RUN_LEDGER_PATH =
    process.env['NEXUS_RUN_LEDGER_PATH'] ?? path.join(repoRoot, 'nexus.run-ledger.jsonl');
  const runEventLedger = new JsonlRunLedgerWriter(RUN_LEDGER_PATH);

  // 4. Policy file (signed — rejects on invalid signature per §15)
  let policyFile = null;
  try {
    policyFile = await loadPolicyFile(POLICY_PATH, controlPlaneKey);
    console.log(`[nexus:mcp] policy: ${policyFile.sortedRules.length} rule(s) loaded and verified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nexus:mcp] policy load failed (default deny will apply): ${msg}`);
  }

  // 5. Registries and stores
  const actorRegistry = new SqliteActorRegistry(db);
  const principalRegistry = new SqlitePrincipalRegistry(db);
  const approverRegistry = new SqliteApproverRegistry(db);
  const sessionStore = new SqliteSessionStore(db);
  const delegationStore = new SqliteDelegationStore(db);
  const pendingStore = new SqlitePendingApprovalStore(db);

  // 6. Classification
  const capabilityRegistry = new CapabilityRegistry();
  const lexicalResolver = LexicalVerbResolver.loadFromFixture(repoRoot);
  const verbNormalizer = new VerbNormalizer(lexicalResolver);
  const targetNormalizer = new TargetNormalizer();
  const dataClassifier = new DataClassifier();
  const riskClassifier = new RiskClassifier(capabilityRegistry);

  // 7. Approval channel — CLI is Channel v1 (MODULAR-004)
  const cliChannel = new CliApprovalChannel(pendingStore);

  // 8. Connector registry — injected from composition root
  const connectorRegistry = opts.createConnectorRegistry();

  // 9. Channel registry
  const channelRegistry = new SimpleChannelRegistry();
  channelRegistry.register(cliChannel);

  // 10. Security
  const replayDetector = new ReplayDetector(db);
  const rateLimiter = new RateLimiter();

  // 11. Gates — fixed order (spec §13.2–§13.8)
  const identityProvider = new RegistryBackedIdentityProvider(actorRegistry, principalRegistry);
  const gates = {
    identity: new IdentityGate(
      actorRegistry,
      sessionStore,
      principalRegistry,
      delegationStore,
      identityProvider
    ),
    classification: new ClassificationGate(
      verbNormalizer,
      targetNormalizer,
      dataClassifier,
      riskClassifier,
      runEventLedger
    ),
    delegation: new DelegationGate(controlPlaneKey, runEventLedger),
    policy: new PolicyGate(runEventLedger),
    approval: new ApprovalGate(controlPlaneKey, runEventLedger),
    execution: new ExecutionGate(controlPlaneKey),
    evidence: new EvidenceGate(ledger, controlPlaneKey),
  };

  // 12. Pipeline — F4.9 wires the claim-drift verifier + run-event ledger
  const claimVerifier = new ReferenceClaimVerifier(async actorIdentifier => {
    const fresh = await identityProvider.resolveIdentity(actorIdentifier as any);
    return (fresh ?? {}) as Record<string, unknown>;
  });
  const pipeline = new Pipeline(gates, replayDetector, rateLimiter, db, modeConfig, {
    verifier: claimVerifier,
    runLedger: runEventLedger,
  });

  // 13. MCP adapter and proxy
  const adapter = new McpAdapter();
  const proxy = new NexusMcpProxy({
    pipeline,
    adapter,
    delegationStore,
    policyFile,
    approverRegistry,
    connectorRegistry,
    channelRegistry,
  });

  // 14. HTTP server — §42 INV-001: bind to 127.0.0.1 only
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'nexus-mcp-proxy', version: 'v0.1.0' }));
      return;
    }
    if (req.method === 'POST') {
      await proxy.handleRequest(req, res);
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  });

  server.listen(PORT, HOST, () => {
    console.log(`[nexus:mcp] listening on http://${HOST}:${PORT}`);
    console.log('[nexus:mcp] ready — awaiting MCP tool calls');
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`\n[nexus:mcp] ${sig} received — shutting down`);
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  }
}
