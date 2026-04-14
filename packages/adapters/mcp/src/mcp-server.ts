/**
 * MCP server entry point — spec §19.1
 * Script: `pnpm nexus:mcp` → `tsx packages/adapters/mcp/src/mcp-server.ts`
 *
 * Wires the full Nexus dependency graph and starts the HTTP proxy server.
 * This file is pure wiring. No business logic lives here.
 *
 * MODULAR-001: MCP adapter calls pipeline.process() only. No gate imports.
 * HOLE-002: Gate 01 is wired with DelegationStore so it can resolve the
 *           identity tuple (actor/principal/delegationContext).
 * SOLVE-007: No session auto-create. Session must already exist.
 * SOLVE-008: Management API localhost-only — not managed here; this is the MCP proxy.
 *
 * Environment variables (all optional — sensible defaults for POC):
 *   NEXUS_DB_PATH       Path to SQLite database (default: ./nexus.db)
 *   NEXUS_LEDGER_PATH   Path to JSONL ledger file (default: ./nexus.ledger.jsonl)
 *   NEXUS_POLICY_PATH   Path to signed policy JSON (default: packages/core/src/policy/rules/default.policy.json)
 *   NEXUS_MCP_PORT      HTTP port for this proxy (default: 4000)
 *   NEXUS_MCP_HOST      Bind host (default: 127.0.0.1)
 *
 * Spec: nexus-engineering-spec-v0-4-6.md §19.1, §19.2
 * Blueprint: nexus-blueprint-v0-3-6.md §5.1, §5.4, §8.1
 */

import * as http from 'node:http';
import * as path from 'node:path';
import * as url from 'node:url';

import {
  // DB
  openDatabase, initializeSchema,
  // Crypto
  loadControlPlaneKey,
  // Ledger
  JsonlLedgerBackend,
  // Policy
  loadPolicyFile,
  // Identity
  ActorRegistry,
  PrincipalRegistry,
  SqliteApproverRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  // Classification
  VerbNormalizer,
  TargetNormalizer,
  CapabilityRegistry,
  DataClassifier,
  RiskClassifier,
  // Gates
  IdentityGate,
  ClassificationGate,
  DelegationGate,
  PolicyGate,
  ApprovalGate,
  ExecutionGate,
  EvidenceGate,
  // Approval
  SqlitePendingApprovalStore,
  CliApprovalChannel,
  // Engine
  Pipeline,
  SimpleConnectorRegistry,
  SimpleChannelRegistry,
  // Security
  ReplayDetector,
  RateLimiter,
} from '@nexus/core';

import { StubConnector } from '../../../connectors/stub/stub.connector.js';
import { McpAdapter } from './mcp-normalizer.js';
import { NexusMcpProxy } from './mcp-proxy.js';

// ── Resolve config from environment ─────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../../../../..');

const DB_PATH      = process.env['NEXUS_DB_PATH']     ?? path.join(repoRoot, 'nexus.db');
const LEDGER_PATH  = process.env['NEXUS_LEDGER_PATH'] ?? path.join(repoRoot, 'nexus.ledger.jsonl');
const POLICY_PATH  = process.env['NEXUS_POLICY_PATH'] ??
  path.join(repoRoot, 'packages/core/src/policy/rules/default.policy.json');
const PORT         = parseInt(process.env['NEXUS_MCP_PORT'] ?? '4000', 10);
const HOST         = process.env['NEXUS_MCP_HOST'] ?? '127.0.0.1';

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[nexus:mcp] starting...');
  console.log(`[nexus:mcp] db:      ${DB_PATH}`);
  console.log(`[nexus:mcp] ledger:  ${LEDGER_PATH}`);
  console.log(`[nexus:mcp] policy:  ${POLICY_PATH}`);
  console.log(`[nexus:mcp] listen:  http://${HOST}:${PORT}`);

  // 1. Database
  const db = openDatabase(DB_PATH);
  initializeSchema(db);

  // 2. Crypto — control-plane keypair (from keys/dev.keypair.json via key-manager)
  const controlPlaneKey = await loadControlPlaneKey();

  // 3. Ledger backend (JSONL — Backend v1, MODULAR-003)
  const ledger = new JsonlLedgerBackend(LEDGER_PATH);

  // 4. Policy file (signed — rejects on invalid signature per spec §15)
  let policyFile = null;
  try {
    policyFile = await loadPolicyFile(POLICY_PATH, controlPlaneKey);
    console.log(`[nexus:mcp] policy: ${policyFile.rules.length} rule(s) loaded and verified`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[nexus:mcp] policy load failed (default deny will apply): ${msg}`);
  }

  // 5. Registries and stores
  const actorRegistry     = new ActorRegistry(db);
  const principalRegistry = new PrincipalRegistry(db);
  const approverRegistry  = new SqliteApproverRegistry(db);
  const sessionStore      = new SqliteSessionStore(db);
  const delegationStore   = new SqliteDelegationStore(db);
  const pendingStore      = new SqlitePendingApprovalStore(db);

  // 6. Classification
  const capabilityRegistry = new CapabilityRegistry();
  const verbNormalizer     = new VerbNormalizer();
  const targetNormalizer   = new TargetNormalizer();
  const dataClassifier     = new DataClassifier();
  const riskClassifier     = new RiskClassifier(capabilityRegistry);

  // 7. Approval channel — CLI is Channel v1 (MODULAR-004)
  const cliChannel = new CliApprovalChannel(pendingStore);

  // 8. Connector registry — StubConnector for POC (MODULAR-005)
  const connectorRegistry = new SimpleConnectorRegistry();
  connectorRegistry.register(new StubConnector());

  // 9. Channel registry
  const channelRegistry = new SimpleChannelRegistry();
  channelRegistry.register(cliChannel);

  // 10. Security
  const replayDetector = new ReplayDetector(db);
  const rateLimiter    = new RateLimiter();

  // 11. Gates — fixed order (spec §13.2–§13.8)
  //     Gate 01 receives DelegationStore (HOLE-002: resolves identity tuple)
  const gates = {
    identity:       new IdentityGate(actorRegistry, sessionStore, principalRegistry, delegationStore),
    classification: new ClassificationGate(verbNormalizer, targetNormalizer, dataClassifier, riskClassifier),
    delegation:     new DelegationGate(controlPlaneKey),
    policy:         new PolicyGate(),
    approval:       new ApprovalGate(controlPlaneKey),
    execution:      new ExecutionGate(controlPlaneKey),
    evidence:       new EvidenceGate(ledger, controlPlaneKey),
  };

  // 12. Pipeline
  const pipeline = new Pipeline(gates, replayDetector, rateLimiter, db);

  // 13. MCP adapter and proxy
  const adapter = new McpAdapter();
  const proxy   = new NexusMcpProxy({
    pipeline,
    adapter,
    delegationStore,
    policyFile,
    approverRegistry,
    connectorRegistry,
    channelRegistry,
  });

  // 14. HTTP server — binds HOST:PORT (default 127.0.0.1:4000)
  //     SOLVE-008: Management API binds 127.0.0.1 — this proxy also respects host binding.
  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'nexus-mcp-proxy', version: 'v0.1.0' }));
      return;
    }

    // All other paths: route to proxy handler
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

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`\n[nexus:mcp] ${sig} received — shutting down`);
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  }
}

main().catch(err => {
  console.error('[nexus:mcp] fatal startup error:', err);
  process.exit(1);
});
