#!/usr/bin/env tsx
/**
 * Nexus CLI — composition root entry point — UNLAYERED
 *
 * This file lives OUTSIDE the seven-layer package architecture (scripts/).
 * It is the sole point where cross-layer construction occurs for the CLI binary.
 * Cross-layer imports are permitted here because this is a composition root.
 *
 * NISP-001.A: wires the 12-step bootstrap (§32a.6) via nexus-bootstrap.ts.
 * The bootstrap result is lazily initialized — only commands that need
 * transport or manifest-loaded state trigger the full startup sequence.
 * The --help path and non-transport commands use the pre-existing factories.
 *
 * COMPOSE-001 fix: serve command uses bootstrapNvgService (wired, lazy)
 * instead of createNvgService (empty). Ad-hoc CLI commands (classify, route)
 * keep the lightweight empty NvgServiceImpl for individual method calls.
 *
 * MODULAR-S29-002 fix: removed @nexus/vanguard from CLI package dependencies.
 * NVG service construction happens here; CLI commands receive Layer 2 interfaces only.
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §22.1
 * Blueprint: nexus-blueprint-v1-5-13.md §24.8
 * Bootstrap: AMEND-spec F-09 §32a.6 (12 steps)
 */

import {
  NvgServiceImpl,
  JsonlRoutingTrailReader,
  loadNvgRoutingPolicy as loadNvgPolicyYaml,
} from '@nexus/vanguard';
import {
  canonicalize,
  verify,
  loadControlPlaneKey,
  mintRootDelegation,
  RegistryBackedIdentityProvider,
  ReferenceClaimVerifier,
  SimpleConnectorRegistry,
  SimpleChannelRegistry,
  SqliteApproverRegistry,
  loadPolicyBundleSet,
  BakedDelegationMint,
} from '@nexus/core';
import { StubConnector } from '@nexus/connector-stub';
import {
  buildPostgresConnector,
  type PostgresConnectorFactoryConfig,
  type PostgresConnector,
} from '@nexus/connector-postgres';
import { createCli } from '@nexus/cli';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

import type {
  Sha256Hex,
  Uuid,
  NonEmpty,
  IsoTimestamp,
  DataClass,
  OrchestratorPlanPreview,
  WorkspaceRunRequest,
  PlannerRequest,
  PlanNode,
  ExecutionPlan,
  NvgOutboundRequest,
  NvgClassifyAndRouteResult,
  NvgInvocationResult,
  CompileRequest,
  CompileReturnEndpointRecord,
  CompileReturnAck,
  FinalResponseArtifact,
  CompileReturnRequest,
  AgentAction,
  Actor,
  Principal,
  PipelineContext,
  PipelineResult,
  IdentityClaimsCapabilityCeiling,
  AgentDeclaration,
  ExplicitDelegationScope,
  Capability,
  FirewallTransitMap,
  RunTypeKind,
  OctLevel,
} from '@nexus/contracts';
import { nowIso, CAPABILITY_IDS, FINAL_OUTCOME, OCT_LEVEL } from '@nexus/contracts';
import { aggregatePayloadLabels, resolveAggregatedProvenance } from '@nexus/runtime-utils';
import { bootstrap, bootstrapWorkspace, type BootstrapResult } from './nexus-bootstrap.js';
import { ActorRegistryAgentReader } from './ref-agent-registry-reader.js';
import {
  RefOrchestrator,
  RefRunCoordinator,
  RefDagExecutor,
  buildPlannerRequestForWorkspace,
} from '@nexus/orch-ref';
import type { NodeDispatchResult, DelegationScope } from '@nexus/orch-ref';
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 5 — registry-based
// planner resolution. The lexicon planner factory is registered + the
// active planner is created via the registry per orchManifest.plannerType.
import { DbLexiconTransformerPlannerFactory, loadLexiconFixtures } from '@nexus/planner-db-lexicon';
import { PlannerFactoryRegistryImpl } from '../packages/core/src/manifest/planners/planner-factory-registry.js';
// NXS Pipeline gates + classification — relative imports (composition root cross-layer).
// The full pipeline stays constructed so admin tooling can route AgentActions
// through it; the workspace prompt path now goes through NVG instead.
import { Pipeline } from '../packages/core/src/engine/pipeline.js';
import { IdentityGate } from '../packages/core/src/gates/01-identity.gate.js';
import { ClassificationGate } from '../packages/core/src/gates/02-classification.gate.js';
import { DelegationGate } from '../packages/core/src/gates/03-delegation.gate.js';
import { PolicyGate } from '../packages/core/src/gates/04-policy.gate.js';
import { ApprovalGate } from '../packages/core/src/gates/05-approval.gate.js';
import { ExecutionGate } from '../packages/core/src/gates/06-execution.gate.js';
import { EvidenceGate } from '../packages/core/src/gates/07-evidence.gate.js';
import { VerbNormalizer } from '../packages/core/src/classification/verb-normalizer.js';
import { LexicalVerbResolver } from '../packages/core/src/classification/lexical-verb-resolver.js';
import { TargetNormalizer } from '../packages/core/src/classification/target-normalizer.js';
import { DataClassifier } from '../packages/core/src/classification/data-classifier.js';
import { RiskClassifier } from '../packages/core/src/classification/risk-classifier.js';
import { CapabilityRegistry } from '../packages/core/src/classification/capability-registry.js';
import { ReplayDetector } from '../packages/core/src/security/replay-detector.js';
import { RateLimiter } from '../packages/core/src/security/rate-limiter.js';
import { loadModeConfig } from '../packages/core/src/modes/mode-manager.js';
// E2E wiring: NVG outbound result → mailbox; compile-return verification helpers.
import { sha256Hex } from '../packages/core/src/output/output-digest.js';
import { createNvgOutputReference } from '../packages/core/src/output/output-reference-adapter.js';
import {
  verifyCallbackAuth,
  recomputeArtifactDigest,
} from '../packages/core/src/compile/compile-return-dispatcher.js';
import { verifyArtifactSignature } from '../packages/core/src/compile/final-response-signer.js';
import { bridgeNxsResultToMailbox } from './nxs-result-mailbox-bridge.js';
import { runDispatchRoundTrip, type NvgTurnResult } from './dispatch-round-trip.js';
import { checkSecureHandoffSlotRead } from './secure-handoff-guard.js';
import { buildToolDescriptorsForAgent, type ConnectorLookup } from './build-tool-schemas.js';
import { resolveNxsSlotBindings } from './nxs-slot-binding-resolver.js';
import type { ToolSchemaDescriptor } from '@nexus/contracts';

const DEFAULT_TRAIL_DIR = path.join(process.cwd(), 'runs');

/**
 * CLAUDE-CODE-FIX-CONTENT-EXTRACTION — extract the assistant's text from an
 * opaque provider response. NVG never inspects payload content (§13.7.1);
 * extraction lives here at the composition boundary so the engine layer
 * stays adapter-agnostic. Each adapter passes the parsed JSON body through
 * `opaqueProviderResponse` unchanged, and each provider has a different
 * shape:
 *   - Ollama:    { message: { role, content: "..." } }
 *   - OpenAI:    { choices: [{ message: { role, content: "..." } }] }
 *   - Anthropic: { content: [{ type: "text", text: "..." }, ...] }
 *
 * Returns '' only when there is genuinely no text content to surface.
 */
function extractAssistantContent(opaqueResponse: unknown): string {
  if (opaqueResponse === null || opaqueResponse === undefined) return '';
  if (typeof opaqueResponse === 'string') return opaqueResponse;
  if (typeof opaqueResponse !== 'object') return '';

  const raw = opaqueResponse as Record<string, unknown>;

  // Ollama: { message: { role: "assistant", content: "..." } }
  const message = raw['message'];
  if (message !== null && message !== undefined && typeof message === 'object') {
    const msgContent = (message as Record<string, unknown>)['content'];
    if (typeof msgContent === 'string') return msgContent;
  }

  // OpenAI: { choices: [{ message: { role: "assistant", content: "..." } }] }
  const choices = raw['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first !== null && first !== undefined && typeof first === 'object') {
      const choiceMsg = (first as Record<string, unknown>)['message'];
      if (choiceMsg !== null && choiceMsg !== undefined && typeof choiceMsg === 'object') {
        const choiceContent = (choiceMsg as Record<string, unknown>)['content'];
        if (typeof choiceContent === 'string') return choiceContent;
      }
    }
  }

  // Anthropic: { content: [{ type: "text", text: "..." }, ...] }
  // Concatenate all text blocks; tool-use / image blocks are skipped.
  const content = raw['content'];
  if (Array.isArray(content) && content.length > 0) {
    const parts: string[] = [];
    for (const block of content) {
      if (block === null || block === undefined || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        parts.push(b['text']);
      }
    }
    if (parts.length > 0) return parts.join('\n\n');
  }

  return '';
}

// ---------------------------------------------------------------------------
// Lazy bootstrap — §32a.6.
// Cached so the 12-step sequence runs at most once per process lifetime.
// The serve command calls getBootstrap() via bootstrapNvgService.
// Ad-hoc commands (--help, classify, route, trail) skip bootstrap.
// ---------------------------------------------------------------------------
let _bootstrapResult: BootstrapResult | null = null;

async function getBootstrap(): Promise<BootstrapResult> {
  if (_bootstrapResult === null) {
    _bootstrapResult = await bootstrap(DEFAULT_TRAIL_DIR);
    // After the 21-step bootstrap returns, resolve credentials for any
    // postgres connector instances declared enabled in the manifest. The
    // postgres connector is the first ship-with-defaults target; the secret
    // source has already been wired into the bootstrap's transport context.
    await ensurePostgresConnectors(_bootstrapResult);
  }
  return _bootstrapResult;
}

// ---------------------------------------------------------------------------
// Postgres connector instances — composition root.
// One instance per enabled manifest entry of connectorType=postgres. Each
// holds its own pg.Pool and resolves its own password via the SecretSource.
// Built once at bootstrap; both connector-registry construction sites
// (the sync createConnectorRegistry callback used by --help/serve-mcp/run
// and the per-NXS-dispatch site inside dispatchToNxs) read from the cache.
// ---------------------------------------------------------------------------
let _postgresConnectors: readonly PostgresConnector[] = [];

/**
 * Resolve credentials and construct a PostgresConnector per enabled manifest
 * entry of connectorType=postgres. Idempotent. Fail-closed: if the manifest
 * declares the connector enabled but the password secret is missing or empty,
 * bootstrap throws — there is no hardcoded fallback.
 *
 * Configuration shape on the manifest entry:
 *   {
 *     host: string,
 *     port: number,
 *     database: string,
 *     user: string,
 *     passwordSecretRef: 'file:KEY' | 'env:KEY' | 'KEY',
 *     systemType: NonEmpty,        // gate-06 lookup key, also in allowedSystems
 *     allowedTables: string[],
 *     displayLabel?: string,
 *     maxRows?: number,
 *     maxConnections?: number,
 *     queryTimeoutMs?: number,
 *     statementTimeoutMs?: number,
 *     connectionTimeoutMs?: number,
 *     ssl?: boolean
 *   }
 */
async function ensurePostgresConnectors(br: BootstrapResult): Promise<void> {
  if (_postgresConnectors.length > 0) return;
  const secretSource = br.transportContext.secretSource;
  const payloadsRoot = path.join(DEFAULT_TRAIL_DIR, 'payloads');
  const built: PostgresConnector[] = [];
  for (const record of br.externals.connectorRecords) {
    if (record.connectorType !== 'postgres') continue;
    const cfg = record.configuration;
    const passwordRef = cfg['passwordSecretRef'];
    if (typeof passwordRef !== 'string' || passwordRef.length === 0) {
      throw new Error(
        `[bootstrap] connector '${record.connectorId}' (postgres) has no passwordSecretRef in its configuration. ` +
          'Add e.g. passwordSecretRef: "file:POSTGRES_SALES_FINANCE_PASSWORD" and re-sign the manifest.'
      );
    }
    const password = await secretSource.resolve(passwordRef);
    if (password === null || password.length === 0) {
      throw new Error(
        `[bootstrap] connector '${record.connectorId}' (postgres) password secret '${passwordRef}' did not resolve. ` +
          'Seed it via the admin dashboard secret form or set the corresponding env var, then restart.'
      );
    }
    const systemTypeRaw = cfg['systemType'];
    if (typeof systemTypeRaw !== 'string' || systemTypeRaw.length === 0) {
      throw new Error(
        `[bootstrap] connector '${record.connectorId}' (postgres) configuration is missing systemType.`
      );
    }
    const allowedTablesRaw = cfg['allowedTables'];
    const allowedTables = Array.isArray(allowedTablesRaw)
      ? allowedTablesRaw.filter((t): t is string => typeof t === 'string')
      : [];
    const factoryConfig: PostgresConnectorFactoryConfig = {
      systemType: systemTypeRaw as NonEmpty,
      dataClass: record.dataClass,
      host: typeof cfg['host'] === 'string' ? cfg['host'] : '127.0.0.1',
      port: typeof cfg['port'] === 'number' ? cfg['port'] : 5432,
      database: typeof cfg['database'] === 'string' ? cfg['database'] : '',
      user: typeof cfg['user'] === 'string' ? cfg['user'] : '',
      password,
      allowedTables,
      payloadsRoot,
      ...(typeof cfg['displayLabel'] === 'string' ? { displayLabel: cfg['displayLabel'] } : {}),
      ...(typeof cfg['maxRows'] === 'number' ? { maxRows: cfg['maxRows'] } : {}),
      ...(typeof cfg['maxConnections'] === 'number'
        ? { maxConnections: cfg['maxConnections'] }
        : {}),
      ...(typeof cfg['queryTimeoutMs'] === 'number'
        ? { queryTimeoutMs: cfg['queryTimeoutMs'] }
        : {}),
      ...(typeof cfg['statementTimeoutMs'] === 'number'
        ? { statementTimeoutMs: cfg['statementTimeoutMs'] }
        : {}),
      ...(typeof cfg['connectionTimeoutMs'] === 'number'
        ? { connectionTimeoutMs: cfg['connectionTimeoutMs'] }
        : {}),
      ...(typeof cfg['ssl'] === 'boolean' ? { ssl: cfg['ssl'] } : {}),
    };
    built.push(buildPostgresConnector(factoryConfig));
    console.log(
      `[bootstrap] postgres connector '${record.connectorId}' constructed for system '${systemTypeRaw}'`
    );
  }
  _postgresConnectors = built;
}

function getPostgresConnectors(): readonly PostgresConnector[] {
  return _postgresConnectors;
}

/**
 * Resolve the dataClass declared by the connector manifest for a target
 * system. Mirrors the lookup pattern already used by `connectorLookup`
 * (nexus-main.ts:965) and the pre-flight probe classification at
 * nexus-main.ts:1735 — the connector manifest is the canonical source.
 * Returns `null` when the system is not registered; callers must fail
 * closed in that case rather than substitute a default class.
 */
function resolveTargetDataClass(systemType: string): DataClass | null {
  if (systemType === new StubConnector().systemType) return new StubConnector().dataClass;
  for (const c of getPostgresConnectors()) {
    if (c.systemType === systemType) return c.dataClass;
  }
  return null;
}

const program = createCli({
  createNvgService: () => new NvgServiceImpl(),
  createTrailReader: (dir?: string) => new JsonlRoutingTrailReader(dir ?? DEFAULT_TRAIL_DIR),
  loadNvgRoutingPolicy: async (filepath: string) => {
    const key = await loadControlPlaneKey();
    return loadNvgPolicyYaml(filepath, key.publicKey, { verify, canonicalize });
  },
  createConnectorRegistry: () => {
    const reg = new SimpleConnectorRegistry();
    reg.register(new StubConnector());
    // Postgres connectors come from the manifest + vault. They are
    // populated by ensurePostgresConnectors() inside getBootstrap(). For
    // pre-bootstrap commands (e.g. --help, classify) the cache is empty
    // and only the stub is registered, which is correct — those paths
    // never dispatch through Gate 06.
    for (const c of getPostgresConnectors()) reg.register(c);
    return reg;
  },
  bootstrapNvgService: async () => {
    const br = await getBootstrap();
    return br.nvgService;
  },
  bootstrapWorkspaceApiDeps: async coreDeps => {
    const br = await getBootstrap();
    // Claude C / SPEC-addendum-beta1-admin-dashboard §3.2:
    // pipe connectorRecords + endpointRecords into the catalog reader so
    // listConnectors/listModels emit claims-filtered data instead of [].
    const wsDeps = await bootstrapWorkspace(coreDeps, {
      connectorRecords: br.externals.connectorRecords,
      endpointRecords: br.endpoints,
    });
    const computeDigest = (obj: unknown): Sha256Hex =>
      createHash('sha256').update(canonicalize(obj)).digest('hex') as Sha256Hex;

    // CLAUDE-CODE-VAULT-SECRET-SOURCE — adapter from VaultSecretSource (Layer 3)
    // to the SecretWriter port consumed by admin-writer.ts (Layer 7). Layer 7
    // never sees the read side (no readSecret method) and never sees plaintext
    // — writeSecret encrypts under the vault key before persisting, and the
    // ChainedSecretSource that Vanguard's transport adapters call decrypts
    // transparently at invoke-time.
    const secretWriter = {
      writeSecret: (k: string, v: string) => br.vaultSecretSource.writeSecret(k, v),
      deleteSecret: (k: string) => br.vaultSecretSource.deleteSecret(k),
      listKeyNames: () => br.vaultSecretSource.listKeyNames(),
      storageLabel: br.secretsStorageLabel,
    };

    // ── ORCH-WIRE-001: Step 22 — Orchestrator assembly ──────────────────
    const orchManifest = br.externals.orchestratorSockets[0];
    if (!orchManifest) {
      console.log('[orch-wire] No orchestrator manifest — dispatch disabled');
      return {
        ...wsDeps,
        // Manifest records for admin-setup projection (Claude C)
        identityRecords: br.externals.identityRecords,
        connectorRecords: br.externals.connectorRecords,
        channelRecords: br.externals.channelRecords,
        workspaceSockets: br.externals.workspaceSockets,
        mailboxRecords: br.externals.mailboxRecords,
        compilerRecords: br.externals.compilerRecords,
        compileReturnRecords: br.externals.compileReturnEndpoints,
        endpoints: br.endpoints,
        computeDigest,
        secretWriter,
      };
    }
    console.log('[orch-wire] Step 22: assembling orchestrator...');

    // 22a. NXS Pipeline (real, all 7 gates)
    const controlPlaneKey = await loadControlPlaneKey();
    const modeConfig = await loadModeConfig(path.join(process.cwd(), 'keys', 'mode-config.json'));
    const capRegistry = new CapabilityRegistry();
    const pipelineIdp = new RegistryBackedIdentityProvider(
      coreDeps.actorRegistry,
      coreDeps.principalRegistry
    );
    // F4.9 — Hard Law #14 claim-drift verifier. Resolver re-reads the
    // actor's current claims via the same IdentityProvider Gate 01 used,
    // so a mid-run RBAC change shows up as drift at every downstream
    // NXS gate (02-07). The Pipeline writes `claim_drift_detected` events
    // into the canonical run-event ledger that the rest of the orch path
    // also uses (`coreDeps.runLedgerWriter`).
    if (!coreDeps.runLedgerWriter) {
      throw new Error(
        '[orch-wire] F4.9: Pipeline requires coreDeps.runLedgerWriter for claim-drift ' +
          'ledger writes (Hard Law #14). Bootstrap step 21 must construct the ledger writer.'
      );
    }
    const pipelineClaimVerifier = new ReferenceClaimVerifier(async actorIdentifier => {
      const fresh = await pipelineIdp.resolveIdentity(actorIdentifier as any);
      return (fresh ?? {}) as Record<string, unknown>;
    });
    // F4.9 §3.2 — NVG carries the same IdentityClaims snapshot the NXS
    // pipeline carries, so the NVG gate runner can verify the snapshot
    // is still current at classify-and-route / return-precheck time.
    // The orch resolves the agent's claims once per dispatch and embeds
    // them on the NvgOutboundRequest before calling NVG.
    const resolveAgentCarriedClaims = async (agentId: string): Promise<Record<string, unknown>> => {
      const fresh = await pipelineIdp.resolveIdentity(agentId as any);
      return (fresh ?? {}) as Record<string, unknown>;
    };
    // F4.9 — attach the same verifier + run-event ledger to the NVG
    // service. Bootstrap Step 12 constructs NvgServiceImpl before the
    // actor/principal registries exist; this is the production-wired
    // attach point. Single-shot setter — guarded against double-attach.
    br.nvgService.attachClaimDriftDeps(pipelineClaimVerifier, coreDeps.runLedgerWriter);
    const nxsPipeline = new Pipeline(
      {
        identity: new IdentityGate(
          coreDeps.actorRegistry,
          // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §2.2 step A — real session
          // store so dispatchToGovernance can create per-run sessions that
          // Gate 01 actually finds (was a stub returning null).
          coreDeps.sessionStore,
          coreDeps.principalRegistry,
          coreDeps.delegationStore,
          pipelineIdp
        ),
        classification: new ClassificationGate(
          new VerbNormalizer(LexicalVerbResolver.loadFromFixture(process.cwd())),
          new TargetNormalizer(),
          new DataClassifier(),
          new RiskClassifier(capRegistry)
        ),
        delegation: new DelegationGate(controlPlaneKey),
        policy: new PolicyGate(),
        approval: new ApprovalGate(controlPlaneKey),
        execution: new ExecutionGate(controlPlaneKey),
        evidence: new EvidenceGate(coreDeps.ledgerBackend, controlPlaneKey),
      },
      new ReplayDetector(coreDeps.db),
      new RateLimiter(),
      coreDeps.db,
      modeConfig,
      { verifier: pipelineClaimVerifier, runLedger: coreDeps.runLedgerWriter }
    );
    console.log('[orch-wire] NXS Pipeline constructed (7 gates)');

    // 22a-bis. Post-Inference Action Normalizer (former §28.1) is RETIRED
    // per F4.20 / Q6 / Hard Laws #5 + #7. Model output cannot trigger NXS;
    // targeted-system actions take the planner-authored nxs_dispatch path
    // only (Spec F4.7). Any `tool_calls` shape in a model response is
    // detected at the NVG return-precheck stage (scripts/dispatch-round-
    // trip.ts) and surfaced via `unsolicited_model_tool_call`; the
    // payload is treated as text. The subordinate LexicalNormalizer
    // (§28.2) stays under @nexus/core for future Gate 02 verb resolution.

    // 22b. AgentRegistryReader — projection over canonical NXS ActorRegistry
    const agentRegistry = new ActorRegistryAgentReader(coreDeps.actorRegistry);

    // ── 17b. PlannerFactoryRegistry construction ───────────────────────
    // AMEND-nexus-planner-db-lexicon-v0-2-1.md §4.1 step 17b. The
    // registry is constructed before fixture load so we can register
    // factories as they become available (step 18a registers the
    // lexicon factory after fixture load).
    const plannerFactoryRegistry = new PlannerFactoryRegistryImpl();

    // ── 18a. Lexicon fixture load + factory registration ──────────────
    // Only fires when the active orchestrator manifest selects the
    // lexicon planner. Fixture I/O is bootstrap-step ownership (row 9
    // ratification) — the factory takes pre-loaded tables and does NOT
    // re-load or re-verify.
    if (orchManifest.plannerType === ('db-lexicon-transformer-v0' as NonEmpty)) {
      const lexiconFixtureRoot =
        (orchManifest.plannerConfiguration?.['lexiconFixtureRoot'] as string | undefined) ??
        'fixtures/planner/db-lexicon';
      // Project the connector-system set from the loaded manifest so
      // the lexicon loader can assert INV-04 (every target catalog
      // system MUST be a known connector system).
      const knownConnectorSystems = new Set<string>();
      for (const c of br.externals.connectorRecords) {
        for (const sys of c.allowedSystems) {
          knownConnectorSystems.add(sys);
        }
      }
      console.log(`[orch-wire] Step 18a: loading lexicon fixtures from ${lexiconFixtureRoot}`);
      const lexiconTables = await loadLexiconFixtures({
        fixtureRoot: lexiconFixtureRoot,
        controlPlanePublicKey: controlPlaneKey.publicKey,
        knownConnectorSystems,
      });
      console.log(
        `[orch-wire] Step 18a: lexicon loaded (${lexiconTables.lexicalTerms.length} terms, ` +
          `${lexiconTables.taskIntents.length} intents, ${lexiconTables.workflowTemplates.length} templates)`
      );
      plannerFactoryRegistry.register(
        new DbLexiconTransformerPlannerFactory(lexiconTables, computeDigest)
      );
    }

    // ── 22c. Planner + DAG executor — resolve planner via registry ────
    // AMEND-nexus-planner-db-lexicon-v0-2-1.md §4.1 step 22c. Fail-closed
    // on missing factory per factories.ts law ("Missing factory resolution
    // fails closed before API traffic starts").
    const plannerFactory = plannerFactoryRegistry.get(orchManifest.plannerType);
    if (!plannerFactory) {
      throw new Error(
        `[orch-wire] Step 22c: no registered PlannerFactory for plannerType ` +
          `'${orchManifest.plannerType}'. Bootstrap fail-closed per factories.ts ` +
          `law — manifest references an unknown plannertype.`
      );
    }
    const planner = await plannerFactory.create(orchManifest);
    console.log(
      `[orch-wire] Step 22c: planner resolved via registry — plannerType '${orchManifest.plannerType}', version '${planner.plannerVersion}'`
    );
    const dagExecutor = new RefDagExecutor(orchManifest.partialCompletion);

    // 22d. Factory: makeDispatchToGovernance — closes over the originating
    // WorkspaceRunRequest so the per-node dispatch can hand the user's prompt
    // to NVG and persist the model response into the mailbox.
    //
    // Flow per blueprint §11.4 + AMEND-spec §6.4:
    //   1. Look up agent in the canonical registry.
    //   2. Build an NvgOutboundRequest from the prompt + plan node + agent
    //      claims. Ollama's chat schema expects messages: [{role,content}], so
    //      the payload mirrors that shape (transport adapter passes through).
    //   3. Call nvgService.classifyAndRoute — classify, route, ceiling, invoke,
    //      RPT. In nvgMode='enforce' this actually invokes the model.
    //   4. On allow + invocation success: persist response bytes to disk, build
    //      an NvgOutputReference, hand it to OutputCollector. The collector
    //      verifies the digest via the file:// resolver, writes the mailbox
    //      item, and emits partial_result on the run ledger.
    //   5. Return NodeDispatchResult so the DAG executor records node_completed.
    const makeDispatchToGovernance = (request: WorkspaceRunRequest) => {
      // ── nxs_dispatch helper (multi-node planner) ───────────────────────
      // Builds an AgentAction from the planner-supplied actionTemplate and
      // dispatches it through the 7-gate pipeline directly. No NVG, no
      // round-trip — these nodes are deterministic side effects (a fixed
      // SQL query, a webhook, etc.) where governance + audit are still
      // required but model thinking is not. The mailbox item is tagged
      // with `taskIdOverride: node.nodeId` so downstream sub-tasks can
      // discover it via inputSlotReads → MailboxService.findBySlot.
      const dispatchNxsNode = async (
        node: PlanNode,
        delegationId: Uuid,
        agent: Actor,
        plan: ExecutionPlan
      ): Promise<NodeDispatchResult> => {
        const tmpl = node.actionTemplate;
        if (!tmpl) {
          return {
            success: false,
            completionMetadata: null,
            failureReason: 'nxs_dispatch_missing_action_template' as NonEmpty,
            governanceDenied: false,
          };
        }

        // Resolve slotBindings — orch supplies runtime values into the
        // pre-resolved actionTemplate before NXS sees it. NXS never sees
        // a binding; it only sees the substituted payload. Phase 2 of
        // multi-node planning (execution-plan.ts NxsSlotBinding).
        //
        // AMEND-nexus-mailbox-pit-v0-2-1 §3.5 — the resolver looks up
        // each upstream slot's mailbox per-binding via
        // mailboxService.getMailboxForActor(runId, upstreamAgentId), so
        // the legacy single mailboxId input is no longer supplied here.
        const resolved = await resolveNxsSlotBindings({
          node,
          plan,
          mailboxService: br.externals.mailboxService,
          runId: request.runId,
        });
        if (!resolved.resolved) {
          return {
            success: false,
            completionMetadata: null,
            failureReason: ('slot_binding_resolve_failed: ' + resolved.reason) as NonEmpty,
            governanceDenied: false,
          };
        }
        const resolvedPayload = resolved.payload;

        // AMEND-nexus-mailbox-pit-v0-2-1 §3.4.4 — emit one
        // `mailbox_slot_resolved_for_dispatch` event per slot binding the
        // resolver consumed. Cross-actor data movement audit; pairs with
        // the same event the nvg-dispatch slot-read loop emits.
        const slotBindings = tmpl.slotBindings ?? [];
        for (const binding of slotBindings) {
          const upstream = plan.nodes.find(n => n.subTaskKey === binding.fromSubTaskKey);
          if (!upstream) continue; // resolver would have failed already
          const upstreamMb = await br.externals.mailboxService.getMailboxForActor(
            request.runId,
            upstream.agentId
          );
          if (upstreamMb === null) continue;
          const item = await br.externals.mailboxService.findBySlot(
            upstreamMb,
            request.runId,
            upstream.nodeId,
            binding.slotId
          );
          if (item === null) continue;
          await coreDeps.runLedgerWriter!.writeEvent({
            runId: request.runId,
            eventType: 'mailbox_slot_resolved_for_dispatch',
            timestamp: nowIso(),
            actorId: node.agentId,
            detail: {
              runId: request.runId,
              readerActorId: node.agentId,
              sourceActorId: upstream.agentId,
              sourceMailboxId: upstreamMb,
              sourceTaskId: upstream.nodeId,
              slotId: binding.slotId,
              mailboxItemId: item.mailboxItemId,
              resolvedAt: nowIso(),
            },
          });
        }

        const sessionId = crypto.randomUUID() as Uuid;
        const sessionTtlSeconds = 10 * 60;
        await coreDeps.sessionStore.create({
          sessionId,
          actorId: node.agentId,
          principalId: request.principalId,
          delegationId,
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + sessionTtlSeconds * 1000).toISOString() as IsoTimestamp,
        });

        // Synthesize verb + target for Gate 02 from the declared
        // capability + target. Gate 02 resolves these back to the
        // canonical capability via the lexicon and capability registry;
        // mismatches surface as denials at Gate 03 / Gate 04 — exactly
        // the governance posture we want.
        const capabilitySegments = tmpl.capability.split(':');
        const verbFromCap = capabilitySegments[0] ?? tmpl.capability;
        const rawTarget = tmpl.target.system;

        const action: AgentAction = {
          actionId: crypto.randomUUID() as Uuid,
          runId: request.runId,
          receivedAt: new Date().toISOString() as IsoTimestamp,
          protocol: 'planner-nxs-dispatch' as NonEmpty,
          adapterVersion: 'planner-nxs-v1' as NonEmpty,
          actorId: node.agentId,
          principalId: request.principalId,
          sessionId,
          delegationId,
          delegationSequence: 0,
          tool: `${verbFromCap}_${rawTarget}` as NonEmpty,
          rawVerb: verbFromCap as NonEmpty,
          rawTarget,
          rawPayload: resolvedPayload,
          intent: {
            objectiveSummary: node.taskSummary,
            triggeringSource: 'planner-nxs-dispatch' as NonEmpty,
            toolchainContext: 'planner-nxs-dispatch' as NonEmpty,
            modelId: null,
            modelConfidence: null,
            riskNote: null,
            extractedAt: new Date().toISOString() as IsoTimestamp,
          },
          resolvedVerb: null,
          resolvedCapability: null,
          resolvedTarget: null,
          resolvedDataClasses: [],
          resolvedRiskTier: null,
        };

        console.log(
          '[orch-wire] nxs_dispatch — run:',
          request.runId,
          'agent:',
          node.agentId,
          'capability:',
          tmpl.capability,
          'target:',
          tmpl.target.system
        );

        // isNvgBypass: true — this dispatch genuinely did NOT traverse
        // NVG. Audit consumers see the bypass annotation and won't be
        // confused by missing NVG entries on this node.
        const nxsResult = await dispatchToNxs({
          rawAction: action,
          runId: request.runId,
          isNvgBypass: true,
        });
        const finalOutcome = nxsResult.evidenceRecord.finalOutcome;
        console.log('[orch-wire] nxs_dispatch outcome:', finalOutcome);

        // Bridge the result into the per-actor mailbox keyed by THIS
        // node's id + declared slot. AMEND-nexus-mailbox-pit-v0-2-1
        // §3.5 — the mailboxId is the dispatching agent's per-run
        // mailbox, allocated at plan_confirmed time by RefRunCoordinator
        // step 3.6 (see allocateForRun).
        const slotId = (node.expectedOutputSlots[0] ?? 'default') as NonEmpty;
        const nxsNodeMailboxId = await br.externals.mailboxService.getMailboxForActor(
          request.runId,
          node.agentId
        );
        if (nxsNodeMailboxId === null) {
          return {
            success: false,
            completionMetadata: null,
            failureReason: ('mailbox_not_allocated_for_actor: agent ' + node.agentId) as NonEmpty,
            governanceDenied: false,
          };
        }
        const targetDataClass = resolveTargetDataClass(tmpl.target.system);
        if (targetDataClass === null) {
          // Connector not registered or unknown — fail closed at the
          // bridge boundary. The pipeline's Gate 06 would already have
          // refused the action, but if we reach here without a
          // dataClass the audit record needs an explicit failure rather
          // than a silently-blocked mailbox item the operator can't
          // diagnose.
          return {
            success: false,
            completionMetadata: {
              evidenceRecordId: nxsResult.evidenceRecord.recordId,
              finalOutcome,
            },
            failureReason: ('nxs_dispatch_bridge_unknown_target_dataclass: ' +
              tmpl.target.system) as NonEmpty,
            governanceDenied: false,
          };
        }
        const bridged = await bridgeNxsResultToMailbox(nxsResult.evidenceRecord, {
          outputCollector: br.externals.outputCollector,
          payloadsRoot: path.join(DEFAULT_TRAIL_DIR, 'payloads'),
          agentOctLevel: agent.octLevel ?? 'OCT-OPEN',
          slotId,
          taskIdOverride: node.nodeId,
          mailboxId: nxsNodeMailboxId,
          targetDataClass,
        });
        if (bridged === null) {
          return {
            success: false,
            completionMetadata: {
              evidenceRecordId: nxsResult.evidenceRecord.recordId,
              finalOutcome,
            },
            failureReason:
              'nxs_dispatch_bridge_returned_null: evidence had no executionResult' as NonEmpty,
            governanceDenied: false,
          };
        }
        console.log(
          '[orch-wire] nxs_dispatch mailbox item:',
          bridged.mailboxItem.mailboxItemId,
          '(' + bridged.kind + ')'
        );

        if (finalOutcome === FINAL_OUTCOME.EXECUTED) {
          return {
            success: true,
            completionMetadata: {
              mailboxItemId: bridged.mailboxItem.mailboxItemId,
              bridgedKind: bridged.kind,
              evidenceRecordId: nxsResult.evidenceRecord.recordId,
              finalOutcome,
            },
            failureReason: null,
            governanceDenied: false,
          };
        }

        const isDeniedOutcome = finalOutcome.startsWith('denied_');
        return {
          success: false,
          completionMetadata: {
            mailboxItemId: bridged.mailboxItem.mailboxItemId,
            bridgedKind: bridged.kind,
            evidenceRecordId: nxsResult.evidenceRecord.recordId,
            finalOutcome,
          },
          failureReason: ('nxs_dispatch_failed: ' + finalOutcome) as NonEmpty,
          governanceDenied: isDeniedOutcome,
        };
      };

      return async (
        node: PlanNode,
        _delegationId: Uuid,
        plan: ExecutionPlan
      ): Promise<NodeDispatchResult> => {
        try {
          const agent = await coreDeps.actorRegistry.get(node.agentId);
          if (!agent) throw new Error('Agent not found in registry: ' + node.agentId);

          // ── Multi-node planner: nxs_dispatch direct path ─────────────
          // For nodes the planner emitted from a `kind: 'nxs'` sub-task,
          // skip NVG entirely. Build an AgentAction from the pre-resolved
          // actionTemplate, run it through the 7-gate pipeline, and bridge
          // the result into the mailbox keyed by nodeId so downstream
          // sub-tasks can read it via inputSlotReads. No round-trip loop;
          // no model spend.
          if (node.nodeType === 'nxs_dispatch') {
            return await dispatchNxsNode(node, _delegationId, agent, plan);
          }

          // ── nvg_dispatch / secure_agent_handoff path ─────────────────
          // CLAUDE-CODE-FILE-ATTACH Phase A §4 — build the messages array
          // for the model. Each text-like attached file becomes a separate
          // user message preceding the prompt so the model sees document
          // context first, then the user's instruction. Binary files (image,
          // pdf) are skipped here — vision-model wiring is a separate
          // enhancement and would belong in a transport adapter that
          // understands content blocks. NVG never inspects this payload
          // (§13.7.1); the transport adapter passes it to the provider
          // unmodified.
          const initialMessages: Array<{ role: string; content: string }> = [];
          for (const file of request.attachedFiles) {
            const isText =
              file.mediaType.startsWith('text/') ||
              file.mediaType === 'application/json' ||
              file.mediaType === 'application/xml' ||
              file.mediaType === 'application/javascript' ||
              file.mediaType === 'application/x-yaml';
            if (!isText) continue;
            initialMessages.push({
              role: 'user',
              content: `[Attached file: ${file.filename} (${file.mediaType})]\n\n${file.content}`,
            });
          }

          // ── F4.11 — collect upstream mailbox items as slot reads are
          // resolved so the NVG dispatch sites below can aggregate
          // dataLabels + provenance from them. The collector is
          // populated inside the slot-read loop so a single pass
          // through the upstream graph feeds both the LLM input
          // framing AND the gate-side classification surface.
          const upstreamMailboxItems: import('@nexus/contracts').MailboxItem[] = [];

          // ── Multi-node planner: pre-seed upstream slot reads ──────────
          // For each entry in the node's inputSlotReads, look up the
          // upstream node by subTaskKey, fetch the latest mailbox item
          // for (runId, upstreamNodeId, slotId), and inject the file body
          // as a user message ahead of the per-node prompt. The model
          // sees the upstream output before being asked to act on it.
          // Phase 1 uses a simple text framing; Phase 2 may add a
          // structured tool_result-shaped variant for tool-aware models.
          if (node.inputSlotReads && node.inputSlotReads.length > 0) {
            for (const ref of node.inputSlotReads) {
              const upstreamNode = plan.nodes.find(n => n.subTaskKey === ref.fromSubTaskKey);
              if (!upstreamNode) {
                // Planner already validates this — defensive throw to
                // surface any future contract drift.
                throw new Error(
                  `inputSlotReads references subTaskKey '${ref.fromSubTaskKey}' but no node has that key`
                );
              }
              // AMEND-nexus-mailbox-pit-v0-2-1 §3.5 — slot reads look in
              // the UPSTREAM actor's mailbox, not a primary. The producing
              // agent's mailbox holds the item we want.
              const upstreamMailboxId = await br.externals.mailboxService.getMailboxForActor(
                request.runId,
                upstreamNode.agentId
              );
              if (upstreamMailboxId === null) {
                return {
                  success: false,
                  completionMetadata: null,
                  failureReason: ('mailbox_not_allocated_for_upstream_actor: ' +
                    upstreamNode.agentId) as NonEmpty,
                  governanceDenied: false,
                };
              }
              const item = await br.externals.mailboxService.findBySlot(
                upstreamMailboxId,
                request.runId,
                upstreamNode.nodeId,
                ref.slotId
              );
              if (item === null) {
                return {
                  success: false,
                  completionMetadata: null,
                  failureReason: ('slot_read_missing: no available mailbox item for ' +
                    `subTask='${ref.fromSubTaskKey}', slot='${ref.slotId}'`) as NonEmpty,
                  governanceDenied: false,
                };
              }
              // ── secure_agent_handoff guard (Phase 1) ──
              // Hard deny when downstream OCT clearance is lower than
              // upstream item's classification. Phase 2 replaces this
              // with redaction at the slot boundary.
              if (node.nodeType === 'secure_agent_handoff') {
                const guard = checkSecureHandoffSlotRead(
                  agent.octLevel ?? null,
                  item.octLevel,
                  ref.fromSubTaskKey,
                  ref.slotId
                );
                if (!guard.allowed) {
                  console.warn('[orch-wire] secure handoff denied —', guard.denyReason);
                  return {
                    success: false,
                    completionMetadata: null,
                    failureReason: guard.denyReason as NonEmpty,
                    governanceDenied: true,
                  };
                }
              }
              if (!item.resultRef.startsWith('file://')) {
                return {
                  success: false,
                  completionMetadata: null,
                  failureReason: ('slot_read_unsupported_scheme: resultRef must be file:// for ' +
                    'Phase 1, got ' +
                    item.resultRef) as NonEmpty,
                  governanceDenied: false,
                };
              }
              const filePath = item.resultRef.slice('file://'.length);
              const body = await fs.readFile(filePath, 'utf-8');
              initialMessages.push({
                role: 'user',
                content: `[Upstream slot ${ref.fromSubTaskKey}.${ref.slotId}]\n\n${body}`,
              });
              // F4.11 — register the upstream item with the aggregator;
              // its resultClassifications + provenance contribute to the
              // NVG dispatch labels below.
              upstreamMailboxItems.push(item);
              // AMEND-nexus-mailbox-pit-v0-2-1 §3.4.4 — emit per-resolution
              // audit event so the cross-actor data movement orch performs
              // is recorded in the run ledger.
              await coreDeps.runLedgerWriter!.writeEvent({
                runId: request.runId,
                eventType: 'mailbox_slot_resolved_for_dispatch',
                timestamp: nowIso(),
                actorId: node.agentId,
                detail: {
                  runId: request.runId,
                  readerActorId: node.agentId,
                  sourceActorId: upstreamNode.agentId,
                  sourceMailboxId: upstreamMailboxId,
                  sourceTaskId: upstreamNode.nodeId,
                  slotId: ref.slotId,
                  mailboxItemId: item.mailboxItemId,
                  resolvedAt: nowIso(),
                },
              });
            }
          }

          // Per-node prompt (sub-task path) or top-level request prompt
          // (legacy path). taskPrompt: null on a sub-task means "use the
          // request-level prompt"; absent on legacy nodes means same.
          const nodePrompt = (node.taskPrompt ?? request.prompt) as NonEmpty;
          initialMessages.push({ role: 'user', content: nodePrompt });

          console.log(
            '[orch-wire] NVG dispatch — run:',
            request.runId,
            'agent:',
            node.agentId,
            'task:',
            node.taskSummary
          );

          // ── Tool-schema bridge (Phase C buildToolDefinitions) ──────
          // Resolve the agent's reachable tool surface ONCE per node
          // dispatch. The list is stable across round-trip turns
          // (agent caps + connector schemas don't change mid-run);
          // we still emit the audit event each turn so replay shows
          // the surface that was attached to every NVG call.
          const connectorLookup: ConnectorLookup = {
            get(systemType) {
              if (systemType === 'stub') return new StubConnector();
              for (const c of getPostgresConnectors()) {
                if (c.systemType === systemType) return c;
              }
              return null;
            },
          };
          // Default-secure Nexus architecture: LLMs NEVER receive tool
          // descriptors. Orch is the deterministic authority that decides
          // what NXS work fires; the LLM is a transformer/summarizer over
          // mailbox contents only. Allowing the model to emit tool_use
          // blocks (the SDK-default round-trip pattern) is a governance
          // bypass — the model could request tools it shouldn't, or call
          // write tools for a read-only prompt. Future plugin slot:
          // `on-prem-llm-planner-v0` planner type can expose tools at
          // planner-time, never at NVG-time. See memory:
          //   feedback_llm_governance_model.md
          //   feedback_nexus_architecture_layers.md
          // The agent's reachable tool surface is still used by orch for
          // binding-axis classification — that's why we still compute
          // `boundConnectorClasses` below. We just don't ship the
          // descriptors to the LLM.
          const agentReachableTools = buildToolDescriptorsForAgent(agent, connectorLookup);
          const toolDescriptors: typeof agentReachableTools = [];
          const toolSchemaDigest: Sha256Hex | null = null;
          // NVG binding-axis floor: data class of every connector this
          // agent can reach (regardless of whether the LLM sees the tool
          // schemas). The NVG classifier takes max across this and the
          // payload labels, so an agent bound to an internal-class
          // connector cannot route through a public-only tier even when
          // the prompt has no labels (§24.2 binding axis).
          const boundConnectorClasses: DataClass[] = Array.from(
            new Set(
              agentReachableTools
                .map(d => connectorLookup.get(d.target.system)?.dataClass)
                .filter((c): c is DataClass => typeof c === 'string' && c.length > 0)
            )
          );
          if (toolDescriptors.length > 0) {
            console.log(
              '[orch-wire] tool surface for',
              node.agentId,
              '·',
              toolDescriptors.length,
              'tools:',
              toolDescriptors.map(d => d.name).join(', ')
            );
          }

          // Per-NVG-turn audit event helper — fires before each
          // classifyAndRoute so the run ledger captures what we
          // authorized the model to consider on every turn (boundary
          // between what we govern + the third-party LLM provider).
          let nvgTurnIndex = 0;
          const emitToolSchemasAttached = async (): Promise<void> => {
            if (toolDescriptors.length === 0) return;
            await coreDeps.runLedgerWriter!.writeEvent({
              runId: request.runId,
              eventType: 'tool_schemas_attached',
              timestamp: nowIso(),
              actorId: node.agentId,
              detail: {
                nodeId: node.nodeId,
                agentId: node.agentId,
                turnIndex: nvgTurnIndex,
                toolCount: toolDescriptors.length,
                toolNames: toolDescriptors.map(d => d.name),
                capabilityRefs: toolDescriptors.map(d => d.capability),
                targetSystems: Array.from(new Set(toolDescriptors.map(d => d.target.system))),
                schemaDigest: toolSchemaDigest,
              },
            });
          };

          // The round-trip loop drives this dispatch through possibly many
          // NVG turns. We capture the LAST allowed/successful turn's
          // metadata so the post-loop mailbox write reflects the final
          // model invocation, not turn 0.
          let lastResult: NvgClassifyAndRouteResult | null = null;
          let lastInv: NvgInvocationResult | null = null;

          const callNvgTurn = async (messages: readonly unknown[]): Promise<NvgTurnResult> => {
            // Audit BEFORE the call — captures what we presented even
            // when the call denies / fails downstream.
            await emitToolSchemasAttached();
            // Wrap messages + descriptors into the structured payload
            // the adapters' PayloadSchema accepts. Empty descriptors →
            // legacy bare-messages-array payload (back-compat for
            // adapters that hadn't seen a structured payload before).
            const turnPayload: unknown =
              toolDescriptors.length > 0 ? { messages, toolDescriptors } : messages;
            // F4.9 — resolve the agent's carried claims at dispatch so the
            // NVG classify-and-route gate runner can verify the snapshot.
            const agentCarriedClaims = await resolveAgentCarriedClaims(node.agentId);
            // F4.11 / HL #6 — dataLabels aggregated from upstream
            // mailbox items + the agent's boundConnectorClasses (the
            // binding-axis floor per §24.2). NVG's §3.3 case split runs
            // against the aggregated provenance: trusted sources floor
            // to internal; untrusted/unknown with no labels denies with
            // NVG_UNKNOWN_PROVENANCE_PAYLOAD.
            const aggregatedLabels = aggregatePayloadLabels(
              upstreamMailboxItems,
              boundConnectorClasses
            );
            const aggregatedProvenance = resolveAggregatedProvenance(upstreamMailboxItems);
            const nvgRequest: NvgOutboundRequest = {
              requestId: crypto.randomUUID() as Uuid,
              runId: request.runId,
              actorId: node.agentId,
              octLevel: agent.octLevel ?? 'OCT-OPEN',
              environmentContext: agent.environment,
              taskIntent: node.taskSummary,
              payload: turnPayload,
              dataLabels: aggregatedLabels,
              boundConnectorClasses,
              costPreference: 'standard',
              latencyPreference: 'standard',
              // CLAUDE-CODE-MODEL-SELECTION-SPEC §2b — surface the user's
              // dropdown preference. NVG treats it as a weighted suggestion
              // within the governed tier set; null = Auto (policy).
              preferredEndpointId: request.preferredEndpointId,
              carriedClaims: agentCarriedClaims,
              provenance: aggregatedProvenance,
            };
            nvgTurnIndex++;
            const result = await br.nvgService.classifyAndRoute(nvgRequest);
            console.log(
              '[nvg] classification:',
              result.classification.effectiveDataClass,
              'route:',
              result.modelTierSelected ?? '<none>',
              'disposition:',
              result.disposition
            );
            if (!result.allowed) {
              console.warn(
                '[nvg] denied —',
                result.denialCode ?? 'unknown',
                ':',
                result.denialReason ?? ''
              );
              return {
                kind: 'denied',
                denialCode: result.denialCode ?? 'nvg_denied',
                reason: result.denialReason ?? '',
              };
            }
            const inv = result.invocation;
            if (!inv || !inv.success) {
              const reason = inv?.reason ?? 'invocation_unavailable';
              const code = inv?.denialCode ?? 'invocation_failed';
              console.warn('[nvg] invocation failed —', code, ':', reason);
              return { kind: 'invocation_failed', code, reason };
            }
            console.log(
              '[nvg] model response —',
              inv.responseSize ?? 0,
              'bytes,',
              inv.latencyMs ?? 0,
              'ms, tier:',
              result.modelTierInvoked ?? '<unknown>'
            );
            lastResult = result;
            lastInv = inv;
            return { kind: 'success', opaqueResponse: inv.opaqueProviderResponse };
          };

          // F4.20 / Q6 / Hard Laws #5 + #7 — model output cannot trigger
          // NXS. Targeted-system actions take the planner-authored
          // nxs_dispatch path only. NVG return-precheck inspects the
          // model response; if any `tool_calls` shape is present, the
          // emission below writes `unsolicited_model_tool_call` and the
          // round-trip outcome is reported as `unsolicited_tool_calls`
          // so the orch treats the response as TEXT (the tool_calls
          // field is dropped before the payload enters the mailbox).
          const emitUnsolicitedToolCall = async (
            toolCalls: ReadonlyArray<{
              readonly toolName: string;
              readonly arguments: unknown;
              readonly providerCallId: string | null;
            }>
          ): Promise<void> => {
            await coreDeps.runLedgerWriter!.writeEvent({
              runId: request.runId,
              eventType: 'unsolicited_model_tool_call',
              timestamp: nowIso(),
              actorId: node.agentId,
              detail: {
                nodeId: node.nodeId,
                disposition: 'treated_as_text',
                toolNames: toolCalls.map(tc => tc.toolName),
                toolCallsExtract: toolCalls.map(tc => ({
                  toolName: tc.toolName,
                  providerCallId: tc.providerCallId,
                  argsDigest: sha256Hex(
                    new TextEncoder().encode(canonicalize(tc.arguments ?? null))
                  ),
                })),
                reason: 'llm_targeted_system_dispatch_forbidden',
              },
            });
            console.warn(
              '[nvg-return-precheck] unsolicited model tool calls treated as text:',
              toolCalls.map(tc => tc.toolName).join(', ')
            );
          };

          const roundTrip = await runDispatchRoundTrip(initialMessages, {
            callNvgTurn,
            emitUnsolicitedToolCall,
          });

          // ── Map round-trip outcomes onto NodeDispatchResult ─────────────
          if (roundTrip.outcome === 'denied') {
            return {
              success: false,
              completionMetadata: {},
              failureReason: (roundTrip.denialCode + ': ' + roundTrip.reason) as NonEmpty,
              governanceDenied: true,
            };
          }
          if (roundTrip.outcome === 'invocation_failed') {
            return {
              success: false,
              completionMetadata: {},
              failureReason: (roundTrip.code + ': ' + roundTrip.reason) as NonEmpty,
              governanceDenied: false,
            };
          }

          // ── 'final' — write the LAST turn's text into the mailbox ───────
          if (lastResult === null || lastInv === null) {
            // Unreachable: callNvgTurn captures both on every successful
            // turn, and 'final' implies at least one success. Defensive.
            throw new Error('round-trip final outcome but no captured turn metadata');
          }
          // Cast to satisfy strict null-narrowing across the await
          // boundary — the captures inside callNvgTurn are non-null when
          // we reach this branch.
          const finalResult: NvgClassifyAndRouteResult = lastResult;
          const finalInv: NvgInvocationResult = lastInv;

          // Extract assistant text from the FINAL opaque provider response
          // and persist it. NVG never inspects this payload (§13.7.1) —
          // extraction happens here at the composition boundary so we can
          // digest + verify the bytes through the file:// resolver.
          const content = extractAssistantContent(roundTrip.finalResponse);
          const payloadDir = path.join(process.cwd(), 'runs', 'payloads', request.runId);
          await fs.mkdir(payloadDir, { recursive: true });
          const finalPayloadId = crypto.randomUUID() as Uuid;
          const payloadPath = path.join(payloadDir, finalPayloadId + '.txt');
          const payloadBytes = new TextEncoder().encode(content);
          await fs.writeFile(payloadPath, payloadBytes);
          const resultRef = ('file://' + path.resolve(payloadPath)) as NonEmpty;
          const resultDigest = sha256Hex(payloadBytes);

          const slotId = (node.expectedOutputSlots[0] ?? 'default') as NonEmpty;
          const outputRef = createNvgOutputReference({
            runId: request.runId,
            taskId: node.nodeId,
            agentId: node.agentId,
            slotId,
            resultRef,
            resultDigest,
            resultClassifications: [finalResult.classification.effectiveDataClass],
            octLevel: agent.octLevel ?? 'OCT-OPEN',
            redactionState: 'not_required',
            // Trail correlation: NVG already wrote outbound + inbound entries
            // under this id; reuse it for cross-linking with the mailbox item.
            routingTrailRecordId: finalResult.trailCorrelationId,
            trailCorrelationId: finalResult.trailCorrelationId,
            modelTierInvoked: finalResult.modelTierInvoked,
            responseSize: finalInv.responseSize ?? null,
          });

          // AMEND-nexus-mailbox-pit-v0-2-1 §3.5 + §3.6 — write to the
          // dispatching agent's per-actor mailbox via typed MailboxWriteContext.
          const nvgWriteMailboxId = await br.externals.mailboxService.getMailboxForActor(
            request.runId,
            node.agentId
          );
          if (nvgWriteMailboxId === null) {
            return {
              success: false,
              completionMetadata: null,
              failureReason: ('mailbox_not_allocated_for_actor: agent ' + node.agentId) as NonEmpty,
              governanceDenied: false,
            };
          }
          const item = await br.externals.outputCollector.writeMailboxItemFromNvgResult(outputRef, {
            runId: request.runId,
            producerActorId: node.agentId,
            mailboxId: nvgWriteMailboxId,
            taskId: node.nodeId,
            slotId,
          });
          console.log(
            '[output] mailbox item',
            item.mailboxItemId,
            'written for run:',
            request.runId,
            roundTrip.outcome === 'unsolicited_tool_calls'
              ? '(unsolicited tool_calls detected: ' +
                  roundTrip.detectedToolCalls.map(tc => tc.toolName).join(',') +
                  ')'
              : ''
          );

          // CLAUDE-CODE-MODEL-SELECTION-SPEC §5 + CLAUDE-CODE-FIX-MODEL-
          // PREFERENCE-ROUTING §3 — record the preference vs. the actually-
          // used endpoint and, when the preference wasn't honored, WHY.
          // preferenceHonored is null (rather than false) when the user
          // supplied no preference — distinguishes "not asked" from
          // "asked but unhonored". Reflects the FINAL turn's endpoint —
          // routing may have switched between turns under retry/fallback.
          //
          // switchReason values (set only when preferenceHonored=false):
          //   - 'preferred_unhealthy_same_tier_sibling' — actual endpoint
          //     is on the SAME tier as the preference (BUG-3 sibling path)
          //   - 'preferred_tier_exhausted_policy_fallback' — actual
          //     endpoint is on a DIFFERENT tier (preferred tier had no
          //     healthy siblings; fell through to policy)
          //   - 'preferred_unknown_endpointId' — preferredEndpointId did
          //     not resolve in the tier registry (stale catalog reference)
          const actualEndpointId = finalInv.endpointUsed?.endpointId ?? null;
          const actualTier = finalInv.endpointUsed?.tier ?? null;
          const preferenceHonored: boolean | null =
            request.preferredEndpointId === null
              ? null
              : actualEndpointId === request.preferredEndpointId;

          let switchReason: string | null = null;
          if (preferenceHonored === false && request.preferredEndpointId) {
            const preferredEp = br.tierRegistry.findEndpointById(
              request.preferredEndpointId as NonEmpty
            );
            if (preferredEp === null) {
              switchReason = 'preferred_unknown_endpointId';
            } else if (actualTier === null) {
              switchReason = 'preferred_no_endpoint_invoked';
            } else if (actualTier === preferredEp.tier) {
              switchReason = 'preferred_unhealthy_same_tier_sibling';
            } else {
              switchReason = 'preferred_tier_exhausted_policy_fallback';
            }
          }

          return {
            success: true,
            completionMetadata: {
              mailboxItemId: item.mailboxItemId,
              modelTierInvoked: finalResult.modelTierInvoked,
              responseSize: finalInv.responseSize ?? null,
              preferredEndpointId: request.preferredEndpointId,
              actualEndpointId,
              preferenceHonored,
              switchReason,
              unsolicitedToolCallNames:
                roundTrip.outcome === 'unsolicited_tool_calls'
                  ? roundTrip.detectedToolCalls.map(tc => tc.toolName)
                  : [],
            },
            failureReason: null,
            governanceDenied: false,
          };
        } catch (err) {
          console.error('[orch-wire] dispatchToGovernance error:', err);
          return {
            success: false,
            completionMetadata: null,
            failureReason: ('dispatch_error: ' + (err as Error).message) as NonEmpty,
            governanceDenied: false,
          };
        }
      };
    };

    // 22e. Factory: makeIssueDelegation — F4.15 / Hard Law #15.
    //
    // The baked DelegationMintPort owns the three-way symmetric
    // intersection arithmetic (user ∩ agent ∩ explicit) across all six
    // dimensions (target_systems, capabilities, oct_level, firewall_
    // rights, run_types, risk_tier). This factory adapts the Principal
    // + Actor + DelegationScope (orch-ref routing metadata) into the
    // canonical DelegationMintInput envelope and routes the result per
    // F4.15 §3.3 — success → delegationId; empty_intersection →
    // delegation_empty_intersection ledger event + throw with dimension;
    // mint_error → delegation_mint_error ledger event + throw.
    //
    // The previous fabricated-UUID fail-open path is retired (Phase B
    // session 1 Patch 12 / GOV-03); this patch additionally enforces
    // the spec's symmetric three-way intersection by reading user-side
    // permittedCapabilities + firewallTransitRights + permittedRunTypes
    // + octLevel + maxRiskTier from the Principal record (Phase B
    // session completion Patch 28). Where a legacy Principal lacks the
    // field, the fallback widens that dimension to the agent's view —
    // accompanied by a `delegation_user_claims_widened` ledger event so
    // audit sees the legacy hop.
    const makeIssueDelegation = (requestingPrincipalId: Uuid, runId: Uuid) => {
      return async (agentId: Uuid, scope: DelegationScope): Promise<Uuid> => {
        const agent = await coreDeps.actorRegistry.get(agentId);
        if (!agent) {
          throw Object.assign(new Error('delegation_mint_failed: Agent not found: ' + agentId), {
            code: 'DELEGATION_MINT_FAILED',
          });
        }

        // Look up the REQUESTING USER's principal — not the agent's registrar.
        const principal = await coreDeps.principalRegistry.get(requestingPrincipalId);
        if (!principal) {
          throw Object.assign(
            new Error('delegation_mint_failed: Principal not found: ' + requestingPrincipalId),
            { code: 'DELEGATION_MINT_FAILED' }
          );
        }

        // Build the F4.15 §2.1 IdentityClaimsCapabilityCeiling from the
        // Principal record. Where the legacy Principal lacks a field,
        // widen to the agent's value (with a ledger note); production
        // RBAC will populate every field as we migrate per §3 B of
        // the alignment outline.
        const widenedClaims: string[] = [];
        const userPermittedCapabilities: ReadonlyArray<Capability> =
          principal.permittedCapabilities ??
          (widenedClaims.push('permittedCapabilities'),
          (agent.allowedCapabilities ?? []) as ReadonlyArray<Capability>);
        const userFirewallTransitRights: FirewallTransitMap =
          principal.firewallTransitRights ??
          (widenedClaims.push('firewallTransitRights'),
          {
            outbound: [],
            inbound: [],
          });
        const userPermittedRunTypes: ReadonlyArray<RunTypeKind> =
          principal.permittedRunTypes ??
          (widenedClaims.push('permittedRunTypes'),
          ['chat', 'sectioned', 'secure_rails', 'autonomous'] as ReadonlyArray<RunTypeKind>);
        const userOctLevel: OctLevel =
          principal.octLevel ?? (widenedClaims.push('octLevel'), agent.octLevel ?? OCT_LEVEL.OPEN);

        if (widenedClaims.length > 0 && coreDeps.runLedgerWriter) {
          // The legacy widening is honest: ledger writes the list so
          // audit + future migration sees exactly which fields RBAC
          // still needs to populate per-principal.
          await coreDeps.runLedgerWriter.writeEvent({
            runId,
            eventType: 'delegation_user_claims_widened',
            timestamp: nowIso(),
            actorId: agentId,
            detail: {
              principalId: requestingPrincipalId,
              widenedFields: widenedClaims,
            },
          });
        }

        const userClaims: IdentityClaimsCapabilityCeiling = {
          principalId: requestingPrincipalId,
          permittedTargetSystems: principal.allowedSystems as ReadonlyArray<NonEmpty>,
          permittedCapabilities: userPermittedCapabilities,
          firewallTransitRights: userFirewallTransitRights,
          permittedRunTypes: userPermittedRunTypes,
          octLevel: userOctLevel,
          maxRiskTier: principal.maxDelegableRiskTier,
        };

        const agentDeclaration: AgentDeclaration = {
          agentId,
          visibleTargetSystems: agent.allowedSystems as ReadonlyArray<NonEmpty>,
          allowedCapabilities: (agent.allowedCapabilities ?? []) as ReadonlyArray<Capability>,
          // Agents today carry firewall transit rights as part of their
          // OCT classification + risk tier; for F4.15 mint the default
          // is "match user" so the agent never narrows further than the
          // user. Production RBAC will populate per-agent.
          firewallTransitRights: userFirewallTransitRights,
          permittedRunTypes: userPermittedRunTypes,
          maxOctLevel: agent.octLevel ?? userOctLevel,
          maxRiskTier: agent.riskCeiling,
        };

        const explicitDelegatedScope: ExplicitDelegationScope = {
          // The orch-ref DelegationScope (plan-routing metadata) does
          // not carry permission narrowing today; the explicit scope is
          // populated from the planner-emitted node's expected reach.
          // Where the planner does not narrow, the explicit scope
          // mirrors the user side (no further intersection).
          targetSystems: userClaims.permittedTargetSystems,
          capabilities: userClaims.permittedCapabilities,
          firewallTransitRights: userClaims.firewallTransitRights,
          runTypes: userClaims.permittedRunTypes,
          maxOctLevel: userClaims.octLevel,
          maxRiskTier: userClaims.maxRiskTier,
          expiresAt: new Date(Date.now() + 3600_000).toISOString() as IsoTimestamp,
        };

        // Per-call BakedDelegationMint instantiation — the signer +
        // persister close over (principal, agent) so concurrent dispatch
        // calls never race on shared state.
        const delegationMint = new BakedDelegationMint({
          signer: async body =>
            mintRootDelegation(principal, agent, {
              principalId: body.principalId,
              actorId: body.actorId,
              allowedSystems: [...body.allowedSystems],
              allowedCapabilities: [...body.allowedCapabilities],
              forbiddenCapabilities: [...body.forbiddenCapabilities],
              maxRiskTier: body.maxRiskTier,
              allowDownstreamPropagation: body.allowDownstreamPropagation,
              environment: agent.environment,
              expiresAt: body.expiresAt,
              maxChainDepth: body.maxChainDepth,
            }),
          newErrorRef: () => crypto.randomUUID() as NonEmpty,
          persister: async dc => {
            await coreDeps.delegationStore.save(dc);
          },
        });

        const result = await delegationMint.mint({
          runId,
          nodeId: scope.taskSummary,
          userClaims,
          agentDeclaration,
          explicitDelegatedScope,
          issuedAt: nowIso(),
          maxChainDepth: orchManifest.maxSplitDepth,
        });

        if (result.kind === 'empty_intersection') {
          await coreDeps.runLedgerWriter?.writeEvent({
            runId,
            eventType: 'delegation_empty_intersection',
            timestamp: nowIso(),
            actorId: agentId,
            detail: {
              principalId: requestingPrincipalId,
              dimension: result.dimension,
              userValues: result.userValues,
              agentValues: result.agentValues,
              explicitValues: result.explicitValues,
            },
          });
          throw Object.assign(
            new Error(
              'delegation_mint_failed: empty intersection on dimension ' + result.dimension
            ),
            { code: 'DELEGATION_EMPTY_INTERSECTION', dimension: result.dimension }
          );
        }
        if (result.kind === 'mint_error') {
          await coreDeps.runLedgerWriter?.writeEvent({
            runId,
            eventType: 'delegation_mint_error',
            timestamp: nowIso(),
            actorId: agentId,
            detail: {
              principalId: requestingPrincipalId,
              reason: result.reason,
              errorRef: result.errorRef,
              detail: result.detail,
            },
          });
          throw Object.assign(
            new Error('delegation_mint_failed: ' + result.reason + ': ' + result.detail),
            { code: 'DELEGATION_MINT_ERROR', reason: result.reason }
          );
        }

        console.log(
          '[orch-wire] delegation issued:',
          result.delegation.delegationId,
          'principal:',
          requestingPrincipalId,
          'agent:',
          agentId,
          'effectiveCapabilities:',
          result.effectiveScope.capabilities.join(',')
        );
        return result.delegation.delegationId;
      };
    };

    // 22f. Glue: triggerCompile, sendPlanCheckback, buildPlannerRequest
    //
    // triggerCompile drives the §6.8 compile chain: build the OutputContract
    // from the run's mailbox state, call CompileService (selects mode, signs
    // FinalResponseArtifact), resolve the compile-return endpoint for the run,
    // dispatch via the signed-callback transport, and only mark mailbox items
    // consumed once the workspace has acknowledged acceptance.
    const triggerCompile = async (runId: Uuid): Promise<void> => {
      console.log('[compile] triggered for run:', runId);
      try {
        // AMEND-nexus-mailbox-pit-v0-2-1 §3.5 — compile reads from every
        // per-actor mailbox allocated for the run, not a primary mailbox.
        const allocatedMailboxes = await br.externals.mailboxService.listMailboxesForRun(runId);
        const mailboxIds = Array.from(allocatedMailboxes.values());
        await coreDeps.runLedgerWriter!.writeEvent({
          runId,
          eventType: 'compile_mailboxes_listed',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            runId,
            mailboxCount: mailboxIds.length,
            mailboxIds,
          },
        });

        const contract = await br.externals.outputCollector.buildOutputContract(runId);
        const compiler = br.externals.socketRegistry.getDefaultCompiler();
        // Aggregate eligible items across every allocated mailbox so
        // compile sees the full per-run cross-actor surface.
        const items = (
          await Promise.all(
            mailboxIds.map(mid => br.externals.mailboxService.listEligibleForCompile(mid, runId))
          )
        ).flat();
        console.log(
          '[compile] mode-eligible items:',
          items.length,
          'across',
          mailboxIds.length,
          'mailbox(es); compiler:',
          compiler.compilerSocketId
        );

        // AMEND-nexus-mailbox-pit-v0-2-1 HOLE-002 closure: OutputContract
        // now carries the full mailboxAllocations map. CompileRequest
        // still has a legacy singular mailboxId field (separate
        // contract); we set it to the alphabetically-first allocated
        // mailbox as a stable representative — the consumer that needs
        // the full set reads contract.mailboxAllocations.
        const allocatedMailboxIdsSorted = Array.from(contract.mailboxAllocations.values()).sort();
        const compileRequestMailboxId =
          (allocatedMailboxIdsSorted[0] as NonEmpty | undefined) ?? ('compile-empty' as NonEmpty);
        const compileRequest: CompileRequest = {
          runId,
          compilerSocketId: compiler.compilerSocketId,
          mailboxId: compileRequestMailboxId,
          outputContractId: contract.outputContractId,
          requestedAt: nowIso(),
        };
        const artifact = await br.externals.compileService.compile(compileRequest, contract, items);
        console.log(
          '[compile] artifact',
          artifact.artifactId,
          'signed (' + artifact.compileMode + '), dispatching return'
        );

        const endpoint = await br.externals.socketRegistry.resolveReturnEndpointForRun(runId);
        const sentAt = nowIso();
        const ack = await br.externals.compileReturnDispatcher.dispatch({
          runId,
          endpoint,
          artifact,
          sentAt,
        });

        if (ack.accepted) {
          // Mark consumed per source mailbox (mailbox-pit V1 — items can
          // come from multiple per-actor mailboxes for the same run).
          for (const mid of mailboxIds) {
            const mineItemIds = items.filter(i => i.mailboxId === mid).map(i => i.mailboxItemId);
            if (mineItemIds.length > 0) {
              await br.externals.mailboxService.markConsumed(mid, runId, mineItemIds);
            }
          }
          console.log('[compile] return accepted at', ack.acceptedAt, '— mailbox items consumed');
        } else {
          console.warn('[compile] return NOT accepted —', ack.reason ?? '<no reason>');
        }
      } catch (err) {
        console.error('[compile] triggerCompile error:', err);
        // Best-effort run_closed on compile failure (T7-F03 pattern).
        try {
          await coreDeps.runLedgerWriter!.writeEvent({
            runId,
            eventType: 'run_closed',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              closeReason: 'error',
              error: (err as Error).message,
            },
          });
        } catch {
          // swallow — original error already logged
        }
      }
    };
    // ── CHECKBACK-spec — Pre-flight + plan checkback ─────────────────────
    //
    // The orchestrator calls `sendPlanCheckback` for every dispatchable run
    // (planCheckbackDefault=true on the default reference orchestrator). This
    // closure runs a non-invoking routing preview against the user's selected
    // agent. If a healthy invocation path exists (primary OR fallback tier
    // healthy), it auto-approves. Otherwise it emits a `plan_checkback_required`
    // event onto the run's SSE stream, suspends the run on a Deferred keyed by
    // runId, and waits for the workspace UI to POST a decision through
    // /workspace/runs/:runId/checkback.
    //
    // Timeout: V1 default = 5 minutes. After that the run auto-denies and is
    // closed by the orchestrator's user-cancelled path (run-coordinator.ts).
    interface PendingCheckback {
      readonly resolve: (decision: boolean) => void;
      readonly timer: ReturnType<typeof setTimeout>;
      readonly expiresAt: number;
    }
    const pendingCheckbacks = new Map<Uuid, PendingCheckback>();
    const CHECKBACK_TIMEOUT_MS = 5 * 60_000;

    /**
     * Suspend the run on a Deferred keyed by runId; the workspace UI's
     * POST /workspace/runs/:runId/checkback wakes it via resolvePendingCheckback.
     *
     * F4.14 / HL #4 — Times out emit `plan_checkback_expired` (NOT
     * plan_checkback_resolved with decision='deny'; that conflated
     * timeout with denial). The promise resolves false so the
     * dispatching node returns control, but the ledger event makes the
     * actual disposition clear: the user has not decided yet. The
     * caller surfaces the expired state in the workspace receipt; the
     * user retains the option to dismiss/restart/extend.
     */
    const waitForCheckback = (runId: Uuid): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        const openedAt = nowIso();
        const timer = setTimeout(() => {
          const stillPending = pendingCheckbacks.get(runId);
          if (stillPending && stillPending.timer === timer) {
            pendingCheckbacks.delete(runId);
            void coreDeps.runLedgerWriter!.writeEvent({
              runId,
              eventType: 'plan_checkback_expired',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                reason: 'checkback_timeout',
                openedAt,
                expiresAfterMs: CHECKBACK_TIMEOUT_MS,
              },
            });
            resolve(false);
          }
        }, CHECKBACK_TIMEOUT_MS);

        pendingCheckbacks.set(runId, {
          resolve,
          timer,
          expiresAt: Date.now() + CHECKBACK_TIMEOUT_MS,
        });
      });

    const makeSendPlanCheckback = (request: WorkspaceRunRequest) => {
      return async (preview: OrchestratorPlanPreview): Promise<boolean> => {
        try {
          const firstAgent = preview.selectedAgents[0];
          if (!firstAgent) {
            // No agent in plan — orchestrator's downstream path handles this.
            return true;
          }
          const agent = await coreDeps.actorRegistry.get(firstAgent.agentId);
          if (!agent) return true;

          // Pre-flight binding axis: the checkback probe must classify with
          // the same agent-aware floor the live dispatch will use, otherwise
          // the checkback's tier prediction can disagree with what NVG later
          // chooses. Pull the agent's reachable connector classes through
          // the lookup the run will use.
          const probeBoundClasses: DataClass[] = Array.from(
            new Set(
              (agent.allowedSystems ?? [])
                .map(sys => {
                  if (sys === 'stub') return new StubConnector().dataClass;
                  for (const c of getPostgresConnectors()) {
                    if (c.systemType === sys) return c.dataClass;
                  }
                  return undefined;
                })
                .filter((c): c is DataClass => typeof c === 'string' && c.length > 0)
            )
          );
          // F4.9 — pre-flight probe carries the same claims envelope the
          // dispatch path will carry, so previewRouting honors HL #14 even
          // for the non-invoking probe (which itself does not run the
          // gate runner — drift detection at probe time is forward-only
          // and the dispatch path re-verifies before invocation).
          const probeCarriedClaims = await resolveAgentCarriedClaims(firstAgent.agentId);
          // F4.11 / HL #6 — probe-side aggregation. Pre-flight has no
          // upstream mailbox items (the dispatch hasn't run yet), so the
          // label surface comes from the binding-axis floor only.
          // Provenance is 'workspace_upload' because the probe's payload
          // is the user's prompt, which originates at the workspace
          // trust boundary — semantically the same trust model as the
          // spec's attachment binder, just for prompt body. When both
          // binding and labels are empty (free_chat agent with no
          // connectors), the §3.3 case split treats workspace_upload as
          // trusted and floors to 'internal' rather than quarantining.
          const probeAggregatedLabels = aggregatePayloadLabels([], probeBoundClasses);
          const probe: NvgOutboundRequest = {
            requestId: crypto.randomUUID() as Uuid,
            runId: request.runId,
            actorId: firstAgent.agentId,
            octLevel: agent.octLevel ?? 'OCT-OPEN',
            environmentContext: agent.environment,
            taskIntent: firstAgent.taskSummary,
            payload: [{ role: 'user', content: request.prompt }],
            dataLabels: probeAggregatedLabels,
            boundConnectorClasses: probeBoundClasses,
            costPreference: 'standard',
            latencyPreference: 'standard',
            // CLAUDE-CODE-MODEL-SELECTION-SPEC §4 — pre-flight inspects the
            // user's preferred endpoint health alongside the policy tier so
            // the checkback message can name a concrete unavailable model.
            preferredEndpointId: request.preferredEndpointId,
            carriedClaims: probeCarriedClaims,
            provenance: 'workspace_upload',
          };

          const routing = await br.nvgService.previewRouting(probe);
          const prefName = routing.preferredEndpoint
            ? routing.preferredEndpoint.modelName + ' (' + routing.preferredEndpoint.tier + ')'
            : '<none>';
          console.log(
            '[orch-wire] pre-flight — primary:',
            routing.primaryTier ?? '<none>',
            routing.primaryHealthy ? '(healthy)' : '(unhealthy)',
            '| fallback:',
            routing.fallbackTier ?? '<none>',
            routing.fallbackHealthy ? '(healthy)' : '(unhealthy)',
            '| preferred:',
            prefName,
            routing.preferredEndpoint
              ? routing.preferredEndpointHealthy
                ? '(healthy)'
                : '(unhealthy)'
              : ''
          );

          // CLAUDE-CODE-MODEL-SELECTION-SPEC §4 — preference-aware pre-flight.
          // When the user picked a specific endpoint:
          //   - healthy + within ceiling → auto-approve (router will use it)
          //   - unhealthy but a sibling on same tier is healthy → auto-approve
          //     (router falls through to sibling silently per §3 case 1d).
          //     plan_checkback_resolved logs this as 'preference_unhealthy_sibling'
          //     so the audit trail captures the implicit substitution.
          //   - whole tier unhealthy → checkback with preference-named message.
          //   - outside-ceiling preferences are denied at NVG dispatch
          //     terminally; pre-flight surfaces them as a checkback so the
          //     user can pick a different model rather than discover the
          //     denial mid-run.
          if (routing.preferredEndpoint) {
            const pref = routing.preferredEndpoint;
            // Outside ceiling → unsalvageable, but the user should know why
            // — surface as checkback so they can pick within-ceiling.
            if (!routing.preferredCeilingAllowed) {
              const message =
                `Your selected model (${pref.modelName} on ${pref.tier}) is outside the ` +
                `tier ceiling allowed by your role. ` +
                (routing.alternativeEndpoint
                  ? `A within-ceiling alternative is available: ${routing.alternativeEndpoint.modelName} on ${routing.alternativeEndpoint.tier}.`
                  : 'No within-ceiling alternative is currently available.');
              console.log(
                '[orch-wire] checkback required (preference outside ceiling) — run:',
                preview.runId,
                '—',
                message
              );
              await coreDeps.runLedgerWriter!.writeEvent({
                runId: preview.runId,
                eventType: 'plan_checkback_required',
                timestamp: nowIso(),
                actorId: null,
                detail: {
                  planDigest: preview.planDigest,
                  primaryTier: routing.primaryTier,
                  primaryHealthy: routing.primaryHealthy,
                  fallbackTier: routing.fallbackTier,
                  fallbackHealthy: routing.fallbackHealthy,
                  alternativeTier: routing.alternativeTier,
                  alternativeEndpoint: routing.alternativeEndpoint,
                  preferredEndpoint: pref,
                  preferredEndpointHealthy: routing.preferredEndpointHealthy,
                  preferredCeilingAllowed: false,
                  reason: 'preference_outside_ceiling',
                  message,
                  requiresUserApproval: true,
                  expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
                },
              });
              return await waitForCheckback(preview.runId);
            }

            // Healthy preference → use it directly.
            if (routing.preferredEndpointHealthy) {
              return true;
            }

            // Unhealthy preference but healthy sibling on same tier exists →
            // silent fallback to sibling (no user prompt, just record it).
            if (routing.preferredTierHasHealthySibling) {
              await coreDeps.runLedgerWriter!.writeEvent({
                runId: preview.runId,
                eventType: 'plan_created',
                timestamp: nowIso(),
                actorId: null,
                detail: {
                  planDigest: preview.planDigest,
                  preferenceSubstitution: 'preference_unhealthy_sibling',
                  preferredEndpoint: pref,
                  note: `Preferred endpoint ${pref.endpointId} is unhealthy; a healthy sibling on tier ${pref.tier} will be used.`,
                },
              });
              return true;
            }

            // Whole preferred tier dead → checkback with preference message.
            const altName = routing.alternativeEndpoint
              ? routing.alternativeEndpoint.modelName +
                ' on ' +
                routing.alternativeEndpoint.endpointId
              : null;
            const message =
              `Your preferred model (${pref.modelName} on ${pref.tier}) is unavailable. ` +
              (altName
                ? `Alternative available: ${altName}.`
                : 'No alternative within your tier ceiling is currently available.');
            console.log(
              '[orch-wire] checkback required (preference unavailable) — run:',
              preview.runId,
              '—',
              message
            );
            await coreDeps.runLedgerWriter!.writeEvent({
              runId: preview.runId,
              eventType: 'plan_checkback_required',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                planDigest: preview.planDigest,
                primaryTier: routing.primaryTier,
                primaryHealthy: routing.primaryHealthy,
                fallbackTier: routing.fallbackTier,
                fallbackHealthy: routing.fallbackHealthy,
                alternativeTier: routing.alternativeTier,
                alternativeEndpoint: routing.alternativeEndpoint,
                preferredEndpoint: pref,
                preferredEndpointHealthy: false,
                preferredCeilingAllowed: true,
                reason: 'preference_unavailable',
                message,
                requiresUserApproval: true,
                expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
              },
            });
            return await waitForCheckback(preview.runId);
          }

          // No preference → existing policy-tier behavior. Auto-approve when
          // there's a healthy path; NVG's invocation chain resolves same-tier
          // retry / fallback transparently.
          if (routing.primaryHealthy || routing.fallbackHealthy) {
            return true;
          }

          // No healthy path on the policy-selected tiers. Surface the
          // alternative (if any) and ask the user.
          const alternativeName = routing.alternativeEndpoint
            ? routing.alternativeEndpoint.modelName +
              ' on ' +
              routing.alternativeEndpoint.endpointId
            : null;
          const message = routing.alternativeTier
            ? `Selected tier ${routing.primaryTier ?? 'unknown'} has no healthy endpoints. ` +
              `An alternative on tier ${routing.alternativeTier} is available` +
              (alternativeName ? ` (${alternativeName}).` : '.')
            : `No healthy endpoints available within your model-tier ceiling. ` +
              `(Selected tier: ${routing.primaryTier ?? 'unknown'}` +
              (routing.denialReason ? `, ${routing.denialReason}` : '') +
              ').';

          console.log('[orch-wire] checkback required — run:', preview.runId, '—', message);

          await coreDeps.runLedgerWriter!.writeEvent({
            runId: preview.runId,
            eventType: 'plan_checkback_required',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              planDigest: preview.planDigest,
              primaryTier: routing.primaryTier,
              primaryHealthy: routing.primaryHealthy,
              fallbackTier: routing.fallbackTier,
              fallbackHealthy: routing.fallbackHealthy,
              alternativeTier: routing.alternativeTier,
              alternativeEndpoint: routing.alternativeEndpoint,
              denialCode: routing.denialCode,
              denialReason: routing.denialReason,
              message,
              requiresUserApproval: true,
              expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
            },
          });

          return await waitForCheckback(preview.runId);
        } catch (err) {
          console.error('[orch-wire] sendPlanCheckback error:', err);
          return false; // fail closed
        }
      };
    };

    /**
     * Resolver invoked by /workspace/runs/:runId/checkback. Returns true iff
     * a pending Deferred existed for this runId — used by the route to
     * differentiate 200 (resolved) from 404 (no pending checkback).
     */
    const resolvePendingCheckback = async (runId: Uuid, allow: boolean): Promise<boolean> => {
      const pending = pendingCheckbacks.get(runId);
      if (!pending) return false;
      pendingCheckbacks.delete(runId);
      clearTimeout(pending.timer);
      await coreDeps.runLedgerWriter!.writeEvent({
        runId,
        eventType: 'plan_checkback_resolved',
        timestamp: nowIso(),
        actorId: null,
        detail: { decision: allow ? 'allow' : 'deny' },
      });
      // F4.8 §2.3 / outline §3 E — `lexicon_signal` records that a user
      // positively resolved a callback. The spec's strict reading is
      // "user picks from top-N candidates" — V1 callbacks today only
      // support binary allow/deny, so we emit on every accept-resolution
      // and tag the v1 source. Admin review queue can filter by `kind`
      // when the planner-rejection-with-candidates path lands the
      // richer payload (promptDigest, arena, chosenIntent, candidate
      // scores) per F4.8 §2.3 in a follow-on Phase B item.
      if (allow) {
        await coreDeps.runLedgerWriter!.writeEvent({
          runId,
          eventType: 'lexicon_signal',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            kind: 'callback_resolved_positive',
            sourceCheckbackKind: 'planner_or_routing_callback',
          },
        });
      }
      pending.resolve(allow);
      return true;
    };

    // Construction-time fallback so the RunCoordinatorDeps contract is
    // satisfied. The real per-run checkback is bound via perRunDeps below
    // (so the closure has the originating WorkspaceRunRequest).
    const sendPlanCheckback = async (_p: OrchestratorPlanPreview): Promise<boolean> => {
      throw new Error(
        '[orch-wire] handleRun called without per-run sendPlanCheckback — request prompt unknown'
      );
    };
    // AMEND-nexus-planner-chat-tier-v0-2-0.md §3.6 — server-side tier
    // derivation. The workspace.entryMode (signed manifest) drives the
    // PlannerRequest discriminator: 'free_chat' → ChatPlannerRequest with
    // tier 'chat'; 'governed_only' → NormalPlannerRequest with tier
    // 'normal'. UI-supplied tier values are ignored. CLAUDE-CODE-MODEL-
    // SELECTION-SPEC §2a (preferredEndpointId) and AMEND-spec-nexus-orch
    // §5 (subTasks DAG) are preserved on the governed branch unchanged.
    const buildPlannerRequest = (request: WorkspaceRunRequest): PlannerRequest => {
      const workspace = br.externals.workspaceSockets.find(
        ws => ws.workspaceSocketId === request.workspaceSocketId
      );
      return buildPlannerRequestForWorkspace({
        request,
        workspace,
        nowIso: () => nowIso() as IsoTimestamp,
      });
    };

    // 22g. Assemble coordinator + orchestrator.
    //
    // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §6 (Option B): the coordinator is
    // stateful (activeRuns map for cancellation), so we keep ONE instance and
    // pass per-request principal-bound functions to handleRun() instead of
    // recreating the coordinator on every run.
    //
    // Construction-time issueDelegation / dispatchToGovernance are fail-loud
    // stubs — every production code path should pass per-run overrides. They
    // exist only to satisfy the RunCoordinatorDeps contract (the orch-ref tests
    // exercise the construction-time path with their own mocks).
    const requirePerRunDeps = (): never => {
      throw new Error(
        '[orch-wire] handleRun called without per-run deps — requesting principalId unknown'
      );
    };
    const coordinator = new RefRunCoordinator(
      orchManifest,
      {
        planner,
        dagExecutor,
        runLedgerWriter: coreDeps.runLedgerWriter!,
        mailboxService: br.externals.mailboxService,
        outputCollector: br.externals.outputCollector,
        computeDigest,
        dispatchToGovernance: requirePerRunDeps,
        issueDelegation: requirePerRunDeps,
        triggerCompile,
        sendPlanCheckback,
        buildPlannerRequest,
        agentRegistry,
        // Orchestrator capability ceiling = the canonical capability taxonomy
        // (§12.4). Wildcards are not accepted here — the planner's visibility
        // check requires concrete capability strings, and a wildcard placeholder
        // would silently filter every agent out. Adding a new capability to
        // CAPABILITY_IDS automatically widens the ceiling on the next boot.
        capabilityCeiling: Object.values(CAPABILITY_IDS) as NonEmpty[],
        maxSplitDepth: orchManifest.maxSplitDepth,
      },
      orchManifest.orchestratorActorId
    );
    const orchestrator = new RefOrchestrator(
      orchManifest.orchestratorSocketId as NonEmpty,
      '1.0.0' as NonEmpty,
      coordinator
    );
    const dispatchToOrchestrator = async (request: WorkspaceRunRequest): Promise<unknown> => {
      console.log(
        '[orch-wire] dispatching for run:',
        request.runId,
        'principal:',
        request.principalId
      );
      // Build per-request issuer + dispatcher + checkback closing over the
      // requesting user's principalId AND the originating prompt — handleRun
      // threads them into every plan-node dispatch and the pre-flight probe.
      const issueDelegation = makeIssueDelegation(request.principalId, request.runId);
      const dispatchToGovernance = makeDispatchToGovernance(request);
      const sendPlanCheckback = makeSendPlanCheckback(request);
      return coordinator.handleRun(request, {
        issueDelegation,
        dispatchToGovernance,
        sendPlanCheckback,
      });
    };

    // Compile-return helpers — bound here so the route can dispatch through the
    // same signed-callback transport that the engine uses, and the receiving
    // /compile-return/:returnEndpointId verifier can verify with the same key.
    const dispatchCompileReturn = async (input: {
      runId: Uuid;
      endpoint: CompileReturnEndpointRecord;
      artifact: FinalResponseArtifact;
      sentAt: IsoTimestamp;
    }): Promise<CompileReturnAck> => {
      return br.externals.compileReturnDispatcher.dispatch(input);
    };

    const verifyCallbackSignature = (
      request: CompileReturnRequest,
      publicKey: string
    ): Promise<boolean> => verifyCallbackAuth(request, publicKey);

    const verifyArtifactSignatureFn = (
      artifact: FinalResponseArtifact,
      publicKey: string
    ): Promise<boolean> => verifyArtifactSignature(artifact, publicKey);

    console.log('[orch-wire] Step 22 complete: orchestrator assembled');

    // ── CLAUDE-CODE-NXS-WIRE-PHASE-B — runtime NXS dispatch ──────────────
    //
    // The NXS pipeline is constructed at line ~243 with all 7 gates wired
    // against real stores. Phase B brings it online by giving routes a
    // single entry point that:
    //   1. Builds a fresh PipelineContext from the live registries +
    //      injected stores (no `as any`, every required field set).
    //   2. Loads the signed default policy file once at runtime — Gate 04
    //      needs LoadedPolicyFile, not a path.
    //   3. Calls pipeline.process(rawAction, context) — every mode produces
    //      an evidence record (Gate 07 always runs).
    //   4. Records the §22.5 bypass annotation (this dispatch is not
    //      preceded by an NVG call) and the nxs_action ledger event so
    //      audit consumers see what entered the pipeline.
    //
    // NVG and NXS remain independent checkpoints — the workspace prompt
    // path doesn't call this. Today the only caller is the admin test
    // route; future inbound adapters that submit governed actions will
    // also call here.
    // P-pol-2: load the default policy bundle plus any operator- /
    // marketplace-supplied bundles in config/policy/. The composer
    // returns a synthetic LoadedPolicyFile with all rules flattened +
    // tagged with bundleRef for audit trace-back. Backward compatible:
    // when config/policy/ is missing or empty, the result equals
    // loading just the default bundle alone (matches today's behavior).
    const nxsPolicyPath = path.join(
      process.cwd(),
      'packages/core/src/policy/rules/default.policy.json'
    );
    const additionalBundlesDir = path.join(process.cwd(), 'config/policy');
    const policyBundleSet = await loadPolicyBundleSet({
      defaultBundlePath: nxsPolicyPath,
      additionalBundlesDir,
      key: controlPlaneKey,
    });
    const nxsPolicyFile = policyBundleSet.composed;
    if (policyBundleSet.bundles.length > 1) {
      console.log(
        '[bootstrap] policy bundles loaded:',
        policyBundleSet.bundles.length,
        '· composed rule count:',
        nxsPolicyFile.rules.length,
        '· bundle ids:',
        policyBundleSet.bundles.map(b => b.bundleId.slice(0, 8)).join(', ')
      );
    }
    const nxsApproverRegistry = new SqliteApproverRegistry(coreDeps.db);

    // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — derive a public-safe
    // policy summary the modes panel can show without re-reading the
    // signed JSON file. Outcome counts aggregate the rule outcome
    // field across rules so the panel can render
    // "6 rules (3 allow, 2 require_approval, 1 escalate)".
    const outcomeCounts: Record<string, number> = {};
    for (const rule of nxsPolicyFile.rules) {
      const o = String(rule.outcome ?? 'unknown');
      outcomeCounts[o] = (outcomeCounts[o] ?? 0) + 1;
    }
    const nxsPolicySummary = {
      bundleId: String(nxsPolicyFile.bundleId),
      version: String(nxsPolicyFile.bundleVersion),
      issuer: String(nxsPolicyFile.issuer),
      defaultOutcome: String(nxsPolicyFile.defaultOutcome),
      ruleCount: nxsPolicyFile.rules.length,
      outcomeCounts,
    };

    // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §1a — capabilities map keyed by
    // connector systemType. Each enabled connector is instantiated
    // once at boot and asked what it supports; the manifest's
    // connectorType matches the connector's systemType so the surface
    // composer can look up `connectorCapabilities.get(r.connectorType)`.
    const stubConnectorInstance = new StubConnector();
    const connectorCapabilities = new Map<string, readonly string[]>([
      [stubConnectorInstance.systemType, stubConnectorInstance.supportedCapabilities()],
    ]);
    // Surface postgres-connector capabilities to the admin dashboard so the
    // operator can see what each configured target advertises (read/write
    // verbs, query/search capabilities) without having to read the source.
    for (const pg of getPostgresConnectors()) {
      connectorCapabilities.set(pg.systemType, pg.supportedCapabilities());
    }

    const buildNxsContext = async (
      action: Omit<AgentAction, 'delegationSequence'>
    ): Promise<PipelineContext> => {
      const actor = await coreDeps.actorRegistry.get(action.actorId);
      if (!actor) throw new Error(`NXS dispatch: actor not found — ${action.actorId}`);
      const principal = await coreDeps.principalRegistry.get(action.principalId);
      if (!principal) {
        throw new Error(`NXS dispatch: principal not found — ${action.principalId}`);
      }
      const delegation = await coreDeps.delegationStore.getById(action.delegationId);
      if (!delegation) {
        throw new Error(`NXS dispatch: delegation not found — ${action.delegationId}`);
      }

      // Per-call connector + channel registries. Connector registry holds
      // every concrete connector instance the manifest declared enabled
      // (plus the stub, which is always available for fixtures and tests).
      // Postgres connectors come from the lazy ensurePostgresConnectors()
      // singleton populated at bootstrap.
      const connectorRegistry = new SimpleConnectorRegistry();
      connectorRegistry.register(new StubConnector());
      for (const c of getPostgresConnectors()) connectorRegistry.register(c);
      const channelRegistry = new SimpleChannelRegistry();

      return {
        sessionId: action.sessionId,
        delegationContext: delegation,
        delegationStore: coreDeps.delegationStore,
        actor,
        principal,
        policyFile: nxsPolicyFile,
        approverRegistry: nxsApproverRegistry,
        connectorRegistry,
        channelRegistry,
        threatLog: [],
        startedAt: nowIso(),
      };
    };

    const dispatchToNxs = async (input: {
      rawAction: Omit<AgentAction, 'delegationSequence'>;
      runId: Uuid;
      /**
       * CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §1 — controls whether
       * the §22.5 `bypass_annotation` ledger event is written.
       *   - true  → action enters NXS WITHOUT a prior NVG call
       *             (admin test route, future direct-adapter inbound)
       *   - false → action follows an NVG model invocation
       *             (post-inference tool calls — NVG was traversed)
       * The annotation tells audit consumers why no NVG trail entries
       * exist for the run; emitting it on a post-inference dispatch
       * would be a false positive.
       */
      isNvgBypass: boolean;
      /**
       * Optional bracket events. When provided, dispatchToNxs emits
       * `run_opened` before invoking the pipeline and `run_closed` after,
       * so admin/test surfaces that are NOT part of the workspace
       * compile-return loop still produce a complete run lifecycle in
       * the ledger. `runOpenDetail` is merged into the run_opened event.
       *
       * EXT-12 OCT-SECURE-LOOP scans only the routes directory; this
       * file (composition root) is the lawful place for non-compile
       * run-bracket writes. Routes should never hand-write run_closed.
       */
      bracketRun?: {
        runOpenDetail: Record<string, unknown>;
      };
    }): Promise<PipelineResult> => {
      const { rawAction, runId } = input;
      console.log(
        '[nxs-wire] dispatching action — run:',
        runId,
        'tool:',
        rawAction.tool,
        'verb:',
        rawAction.rawVerb,
        'bypass:',
        input.isNvgBypass
      );

      // run_opened — only when the caller is the originator of the run
      // (e.g. admin test route). Skipping when the run already has a
      // workspace-side run_opened keeps the ledger from double-bracketing.
      if (input.bracketRun) {
        await coreDeps.runLedgerWriter!.writeEvent({
          runId,
          eventType: 'run_opened',
          timestamp: nowIso(),
          actorId: null,
          detail: input.bracketRun.runOpenDetail,
        });
      }

      const context = await buildNxsContext(rawAction);
      const result = await nxsPipeline.process(rawAction, context);
      const evidence = result.evidenceRecord;

      // §22.5 bypass annotation BEFORE the action event — only when this
      // dispatch genuinely DID NOT traverse NVG. Post-inference tool
      // calls (Phase C) pass isNvgBypass:false because the model was
      // invoked through NVG before it returned the tool call.
      if (input.isNvgBypass) {
        await coreDeps.runLedgerWriter!.writeEvent({
          runId,
          eventType: 'bypass_annotation',
          timestamp: nowIso(),
          actorId: null,
          detail: { bypass_path: true, nvg_entries: false },
        });
      }

      await coreDeps.runLedgerWriter!.writeEvent({
        runId,
        eventType: 'nxs_action',
        timestamp: nowIso(),
        actorId: rawAction.actorId,
        detail: {
          actionId: rawAction.actionId,
          tool: rawAction.tool,
          verb: rawAction.rawVerb,
          target: rawAction.rawTarget,
          finalOutcome: evidence.finalOutcome,
          evidenceRecordId: evidence.recordId,
          ledgerSequence: evidence.ledgerSequence,
          policyOutcome: evidence.policyOutcome,
          disposition: result.disposition,
        },
      });

      // run_closed bracket — symmetric to run_opened above.
      if (input.bracketRun) {
        await coreDeps.runLedgerWriter!.writeEvent({
          runId,
          eventType: 'run_closed',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            ...input.bracketRun.runOpenDetail,
            finalOutcome: evidence.finalOutcome,
            evidenceRecordId: evidence.recordId,
          },
        });
      }

      console.log(
        '[nxs-wire] result — outcome:',
        evidence.finalOutcome,
        'evidence:',
        evidence.recordId
      );
      return result;
    };

    return {
      ...wsDeps,
      // CLAUDE-CODE-NXS-WIRE-PHASE-B — runtime entry into the 7-gate chain.
      dispatchToNxs,
      // CLAUDE-CODE-ADMIN-PANELS-PHASE-D — admin-setup data threaded
      // through to the connector + modes panels.
      connectorCapabilities,
      nxsPolicySummary,
      // Manifest records for admin-setup projection (Claude C)
      identityRecords: br.externals.identityRecords,
      connectorRecords: br.externals.connectorRecords,
      channelRecords: br.externals.channelRecords,
      workspaceSockets: br.externals.workspaceSockets,
      orchestratorSockets: br.externals.orchestratorSockets,
      mailboxRecords: br.externals.mailboxRecords,
      compilerRecords: br.externals.compilerRecords,
      compileReturnRecords: br.externals.compileReturnEndpoints,
      endpoints: br.endpoints,
      orchestrator,
      dispatchToOrchestrator,
      computeDigest,
      pipelineInterface: nxsPipeline,
      // CHECKBACK-spec — exposes the resolver so the workspace POST route can
      // wake the pending Deferred in sendPlanCheckback when the user replies.
      resolvePendingCheckback,
      // E2E wiring — services threaded so reference harness routes can call
      // the real engines, and the workspace flow can roundtrip a prompt
      // through NVG → mailbox → compile → return.
      nvgService: br.nvgService,
      mailboxService: br.externals.mailboxService,
      outputCollector: br.externals.outputCollector,
      compileService: br.externals.compileService,
      getDefaultCompiler: () => br.externals.socketRegistry.getDefaultCompiler(),
      getPrimaryMailbox: () => br.externals.socketRegistry.getPrimaryMailbox(),
      resolveReturnEndpointForRun: (runId: Uuid) =>
        br.externals.socketRegistry.resolveReturnEndpointForRun(runId),
      dispatchCompileReturn,
      // Compile-return route verification helpers — used by the receiving
      // /compile-return/:returnEndpointId handler to validate the signed
      // callback and the artifact before writing run_closed.
      getReturnEndpoint: (returnEndpointId: string) =>
        br.externals.socketRegistry.getReturnEndpoint(returnEndpointId as NonEmpty),
      verifyCallbackSignature,
      verifyArtifactSignature: verifyArtifactSignatureFn,
      recomputeArtifactDigest,
      controlPlanePublicKey: br.controlPlanePublicKey,
      // Body resolver for the compile-return route — reads the file:// URI
      // produced by DeterministicRenderer so `final_response` can carry the
      // rendered text inline. Strips the URI scheme; the path is whatever
      // the renderer wrote relative to cwd.
      resolveArtifactBody: async (ref: NonEmpty): Promise<string> => {
        const raw = String(ref);
        if (!raw.startsWith('file://')) {
          throw new Error('resolveArtifactBody: only file:// refs supported, got ' + raw);
        }
        const filePath = raw.slice('file://'.length);
        return fs.readFile(path.resolve(filePath), 'utf-8');
      },
      // CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — admin secret onboarding (write-only port).
      secretWriter,
    };
  },
});

// Filter out bare '--' that pnpm may inject between script path and subcommands.
const argv = process.argv.filter((arg, idx) => !(arg === '--' && idx === 2));
program.parse(argv);
