/**
 * Nexus CLI — command tree definition
 *
 * This file exports createCli(deps) which builds the Commander program.
 * It does NOT self-execute — the composition root (scripts/nexus-main.ts) calls
 * createCli() with injected NVG dependencies and calls program.parse().
 *
 * Layer imports:
 *   @nexus/contracts (Layer 2) — type contracts only
 *   @nexus/core (Layer 1) — sole permitted cross-layer import per §24.8
 *   NO @nexus/vanguard (Layer 3) — MODULAR-S29-002 fix
 *   NO @nexus/connector-stub (Layer 5) — MODULAR-S29-002 fix
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §22.1
 * Blueprint: nexus-blueprint-v1-5-13.md §24.8
 */
import { Command } from 'commander';
import type {
  NvgService,
  RoutingTrailReader,
  ConnectorRegistry,
  NvgRoutingPolicy,
} from '@nexus/contracts';
import { cmdInit } from './commands/init.js';
import { cmdSessionStart } from './commands/session.js';
import { cmdDelegate } from './commands/delegate.js';
import { cmdRun } from './commands/run.js';
import type { RunOptions } from './commands/run.js';
import { cmdApprove, cmdDeny } from './commands/approve.js';
import { cmdLedgerTail, cmdLedgerVerify, cmdLedgerGet } from './commands/ledger.js';
import { cmdPolicyValidate, cmdPolicyTest } from './commands/policy.js';
import { cmdActorRegister, cmdActorList } from './commands/actor.js';
import { cmdPrincipalRegister } from './commands/principal.js';
import { cmdApproverKeygen } from './commands/approver.js';
import { cmdPosture } from './commands/posture.js';
import { cmdReplay } from './commands/replay.js';
import { cmdServe } from './commands/serve.js';
import { cmdServeMcp } from './commands/serve-mcp.js';
import { cmdModeShow, cmdModeSet } from './commands/mode.js';
import { cmdRunLedgerTail, cmdRunLedgerGet } from './commands/run-ledger.js';
import { cmdNvgClassify, cmdNvgRoute, cmdNvgTrail, cmdNvgPolicyValidate } from './commands/nvg.js';
import { SCENARIO_MANIFEST } from '@nexus/core';
import type { ScenarioId } from '@nexus/core';

// ── CLI dependency injection interface ────────────────────────────────────────

export interface CliDeps {
  /** Factory: construct an NvgService instance (Layer 3 impl injected from composition root) */
  createNvgService: () => NvgService;
  /** Factory: construct a RoutingTrailReader (Layer 3 impl injected from composition root) */
  createTrailReader: (dir?: string) => RoutingTrailReader;
  /** Factory: construct a ConnectorRegistry (Layer 5 impl injected from composition root) */
  createConnectorRegistry: () => ConnectorRegistry;
  /** Load + verify signed YAML NVG routing policy (CONTRA-S29-001) */
  loadNvgRoutingPolicy: (filepath: string) => Promise<NvgRoutingPolicy>;
}

// ── createCli — builds the Commander program with injected dependencies ───────

export function createCli(deps: CliDeps): Command {
  const program = new Command();
  program
    .name('nexus')
    .description('Nexus — Agent Action Router and Authority Governance Layer')
    .version('0.1.0');

  program
    .command('init')
    .description('Generate dev keypair + admin token')
    .action(() => cmdInit().catch(fatal));

  const session = program.command('session').description('Session management');
  session
    .command('start')
    .description('Create session')
    .requiredOption('--actor <id>', 'Actor ID')
    .requiredOption('--delegation <id>', 'Delegation ID')
    .option('--ttl <seconds>', 'TTL in seconds', v => parseInt(v, 10))
    .action(opts =>
      cmdSessionStart({ actor: opts.actor, delegation: opts.delegation, ttl: opts.ttl }).catch(
        fatal
      )
    );

  program
    .command('delegate')
    .description('Mint root delegation')
    .requiredOption('--principal <id>')
    .requiredOption('--actor <id>')
    .requiredOption('--systems <csv>')
    .requiredOption('--caps <csv>')
    .option('--forbidden <csv>')
    .requiredOption('--max-risk <tier>')
    .requiredOption('--env <env>')
    .requiredOption('--ttl <seconds>', '', v => parseInt(v, 10))
    .option('--max-chain-depth <n>', '', v => parseInt(v, 10))
    .option('--allow-propagation')
    .action(opts =>
      cmdDelegate({
        principal: opts.principal,
        actor: opts.actor,
        systems: opts.systems,
        caps: opts.caps,
        forbidden: opts.forbidden,
        maxRisk: opts.maxRisk,
        env: opts.env,
        ttl: opts.ttl,
        maxChainDepth: opts.maxChainDepth,
        allowPropagation: opts.allowPropagation,
      }).catch(fatal)
    );

  program
    .command('run')
    .description('Execute run orchestrator')
    .option('--scenario <id>')
    .option('--fixtures <mode>')
    .option('--out-dir <path>')
    .action(opts => {
      if (!opts.scenario && !opts.fixtures) {
        console.error('✗ Specify --scenario <id> or --fixtures');
        process.exit(1);
      }
      const runOpts = {
        ...(opts.scenario ? { scenario: opts.scenario as ScenarioId } : {}),
        fixturesAll: Boolean(opts.fixtures),
        ...(opts.outDir ? { outDir: opts.outDir as string } : {}),
      };
      cmdRun({ ...runOpts, createConnectorRegistry: deps.createConnectorRegistry }).catch(fatal);
    });

  program
    .command('approve <approvalId>')
    .description('Approve pending action')
    .requiredOption('--approver-id <id>')
    .action((approvalId, opts) =>
      cmdApprove(approvalId, { approverId: opts.approverId }).catch(fatal)
    );
  program
    .command('deny <approvalId>')
    .description('Deny pending action')
    .requiredOption('--approver-id <id>')
    .option('--note <reason>')
    .action((approvalId, opts) =>
      cmdDeny(approvalId, { approverId: opts.approverId, note: opts.note }).catch(fatal)
    );

  const ledger = program.command('ledger').description('Ledger inspection');
  ledger
    .command('tail')
    .option('--n <n>', '', v => parseInt(v, 10))
    .action(opts => cmdLedgerTail({ n: opts.n }).catch(fatal));
  ledger
    .command('verify')
    .option('--from <n>', '', v => parseInt(v, 10))
    .option('--to <n>', '', v => parseInt(v, 10))
    .action(opts => cmdLedgerVerify({ from: opts.from, to: opts.to }).catch(fatal));
  ledger.command('get <recordId>').action(recordId => cmdLedgerGet(recordId).catch(fatal));

  const policy = program.command('policy').description('Policy management');
  policy
    .command('validate <filepath>')
    .action(filepath => cmdPolicyValidate(filepath).catch(fatal));
  policy
    .command('test <filepath> <actionJson>')
    .action((filepath, actionJson) => cmdPolicyTest(filepath, actionJson).catch(fatal));

  const actor = program.command('actor').description('Actor management');
  actor.command('register <json>').action(json => cmdActorRegister(json).catch(fatal));
  actor.command('list').action(() => cmdActorList().catch(fatal));

  const principal = program.command('principal').description('Principal management');
  principal.command('register <json>').action(json => cmdPrincipalRegister(json).catch(fatal));

  const approver = program.command('approver').description('Approver management');
  approver
    .command('keygen')
    .requiredOption('--approver-id <id>')
    .action(opts => cmdApproverKeygen(opts.approverId).catch(fatal));

  program
    .command('posture')
    .description('Token posture report')
    .action(() => cmdPosture().catch(fatal));
  program
    .command('replay <runDir>')
    .description('Verify CCV replay hashes')
    .action(runDir => cmdReplay(runDir).catch(fatal));

  // ── serve: NVG deps injected from composition root ────────────────────────
  program
    .command('serve')
    .description('Start Management API server with DI (§23.1)')
    .option('--port <port>', 'API port', v => parseInt(v, 10))
    .action(opts =>
      cmdServe({
        port: opts.port,
        createNvgService: deps.createNvgService,
        createTrailReader: deps.createTrailReader,
        loadNvgRoutingPolicy: deps.loadNvgRoutingPolicy,
      }).catch(fatal)
    );

  // ── serve-mcp: DEF-025 — MCP proxy HTTP server ─────────────────────────
  program
    .command('serve-mcp')
    .description('Start MCP proxy HTTP server (§19.1)')
    .option('--port <port>', 'MCP proxy port', v => parseInt(v, 10))
    .option('--host <host>', 'Bind host (default: 127.0.0.1)')
    .action(opts =>
      cmdServeMcp({
        port: opts.port,
        host: opts.host,
        createConnectorRegistry: deps.createConnectorRegistry,
      }).catch(fatal)
    );

  // §22.1 — mode commands
  const mode = program.command('mode').description('Operating mode management');
  mode
    .command('show')
    .description('Show current operating modes')
    .action(() => cmdModeShow().catch(fatal));
  mode
    .command('set')
    .description('Set operating mode')
    .requiredOption('--engine <nxs|nvg>', 'Engine (nxs or nvg)')
    .requiredOption('--mode <observe|advisory|enforcing>', 'Mode')
    .action(opts => cmdModeSet({ engine: opts.engine, mode: opts.mode }).catch(fatal));

  // §22.1 — run-ledger commands
  const runLedgerCmd = program.command('run-ledger').description('Run Ledger inspection');
  runLedgerCmd
    .command('tail')
    .option('--n <n>', 'Number of entries', v => parseInt(v, 10))
    .action(opts => cmdRunLedgerTail({ n: opts.n }).catch(fatal));
  runLedgerCmd.command('get <run-id>').action(runId => cmdRunLedgerGet(runId).catch(fatal));

  // §22.1 — NVG commands — deps injected from composition root
  const nvg = program.command('nvg').description('NVG wall enforcement');
  nvg
    .command('classify <request-json>')
    .description('Classify data and check OCT ceiling')
    .action(json => cmdNvgClassify(json, deps.createNvgService()).catch(fatal));
  nvg
    .command('route <request-json>')
    .description('Route to model tier per policy')
    .action(json => cmdNvgRoute(json, deps.createNvgService()).catch(fatal));
  nvg
    .command('trail')
    .description('Show Routing Provenance Trail')
    .option('--run-id <id>', 'Filter by run ID')
    .action(opts => cmdNvgTrail({ runId: opts.runId }, deps.createTrailReader()).catch(fatal));
  nvg
    .command('policy-validate <filepath>')
    .description('Validate NVG routing policy')
    .action(filepath => cmdNvgPolicyValidate(filepath, deps.loadNvgRoutingPolicy).catch(fatal));

  return program;
}

function fatal(err: unknown): void {
  console.error(`✗ Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
