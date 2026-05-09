#!/usr/bin/env tsx
/**
 * Nexus Bootstrap — spec §32a.6, AMEND-spec §5.1-§5.4
 *
 * 21-step startup wiring. All registries populated BEFORE any
 * manifest loader runs (§12.3.48 invariant 3). Fail-closed on every step.
 *
 * This is a composition root — cross-layer imports are permitted.
 *
 * Steps 1-12:  Original NVG/NISP (unchanged)
 * Steps 13-17: Load five externals manifests
 * Step 18:     Cross-domain collision + cross-reference validation
 * Step 19:     Construct MailboxBackend + baked MailboxService
 * Step 20:     Construct ExternalSocketRegistry, DeclaredOutputSlotReader,
 *              PayloadResolver set, OutputCollector
 * Step 21:     Construct CompileService, CompileReturnDispatcher, reference
 *              deterministic compiler, assemble ExternalsRuntime,
 *              return full BootstrapResult
 *
 * Governing law:
 *   §32a.6  — bootstrap order (steps 1-12)
 *   §5.1    — expanded bootstrap order (steps 13-21)
 *   §5.2    — ExternalsRuntime + BootstrapResult expansion
 *   §5.3    — fail-closed startup rule
 *   §5.4    — baked runtime services
 *   §4.7    — cross-domain collision law (9 domains)
 *   §12.3.48 — factory registry behavior law (4 invariants)
 *   §32a.4  — RIA legacy bridge conditions
 *   §14.6.6 — fail closed on empty/all-disabled manifests
 *   §25.1   — NVG routing policy: signed YAML, Ed25519 signature verification
 *   §9.2    — mode configuration: signed, fail-closed on invalid signature
 */

import type {
  Actor,
  ActorRegistry,
  PrincipalRegistry,
  IdentityProviderFactory,
  ConnectorFactory,
  ApprovalChannelFactory,
  NvgTransportContext,
  ModelEndpoint,
  NonEmpty,
  ModeConfiguration,
  NvgRoutingPolicy,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
  IdentityProviderManifestRecord,
  ConnectorManifestRecord,
  ChannelManifestRecord,
  WorkspaceFactory,
  OrchestratorFactory,
  MailboxBackendFactory,
  CompilerFactory,
  CompileReturnTransportFactory,
  CompileReturnTransport,
  CompileReturnAck,
  CompileReturnRequest,
  CompileConfig,
  MailboxService,
  OutputCollector,
  CompileService,
  CompileTemplate,
  PayloadResolver,
  Uuid,
} from '@nexus/contracts';

// ── Core: crypto ─────────────────────────────────────────────────────────────
import {
  loadControlPlaneKey,
  loadWorkspaceJwtSecret,
  loadDevAdminApiKey,
} from '../packages/core/src/crypto/key-manager.js';
import { verify } from '../packages/core/src/crypto/verifier.js';
import { canonicalize } from '../packages/core/src/crypto/canonicalize.js';

// ── Core: mode management (§9) ──────────────────────────────────────────────
import {
  loadModeConfig,
  createDefaultModeConfig,
  saveModeConfig,
} from '../packages/core/src/modes/mode-manager.js';

// ── Core: factory registries (§12.3.45–.47) — original 3 ────────────────────
import { IdentityProviderFactoryRegistry } from '../packages/core/src/manifest/identity/identity-provider-factory-registry.js';
import { ConnectorFactoryRegistry } from '../packages/core/src/manifest/connectors/connector-factory-registry.js';
import { ApprovalChannelFactoryRegistry } from '../packages/core/src/manifest/channels/channel-factory-registry.js';

// ── Core: factory registries — externals 5 (§5.1) ───────────────────────────
import { WorkspaceFactoryRegistry } from '../packages/core/src/manifest/workspace/workspace-factory-registry.js';
import { OrchestratorFactoryRegistry } from '../packages/core/src/manifest/orchestrators/orchestrator-factory-registry.js';
import { MailboxBackendFactoryRegistry } from '../packages/core/src/manifest/mailbox/mailbox-factory-registry.js';
import { CompilerFactoryRegistry } from '../packages/core/src/manifest/compile/compiler-factory-registry.js';
import { CompileReturnTransportFactoryRegistry } from '../packages/core/src/manifest/output/compile-return-factory-registry.js';

// ── Core: manifest loaders (§32a.2.1–.3) — original 3 ──────────────────────
import { loadIdentityManifest } from '../packages/core/src/manifest/identity/identity-manifest-loader.js';
import { loadConnectorManifest } from '../packages/core/src/manifest/connectors/connector-manifest-loader.js';
import { loadChannelManifest } from '../packages/core/src/manifest/channels/channel-manifest-loader.js';

// ── Core: manifest loaders — externals 5 (§5.1) ─────────────────────────────
import { loadWorkspaceManifest } from '../packages/core/src/manifest/workspace/workspace-manifest-loader.js';
import { loadOrchestratorManifest } from '../packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.js';
import { loadMailboxManifest } from '../packages/core/src/manifest/mailbox/mailbox-manifest-loader.js';
import { loadCompilerManifest } from '../packages/core/src/manifest/compile/compiler-manifest-loader.js';
import { loadCompileReturnManifest } from '../packages/core/src/manifest/output/compile-return-manifest-loader.js';

// ── Core: mailbox (§7, §5.4) ────────────────────────────────────────────────
import { LocalJsonlMailboxBackend } from '../packages/core/src/mailbox/local-jsonl-mailbox.backend.js';
import { MailboxServiceImpl } from '../packages/core/src/mailbox/mailbox-service.js';

// ── Core: output (§6.7, §5.4) ───────────────────────────────────────────────
import { OutputCollectorImpl } from '../packages/core/src/output/output-collector.js';
import { RunLedgerSlotReader } from '../packages/core/src/output/declared-output-slot-reader.js';
import { PayloadResolverRegistryImpl } from '../packages/core/src/output/payload-resolver.js';

// ── Core: compile (§8, §3.10, §5.4) ─────────────────────────────────────────
import { CompileServiceImpl } from '../packages/core/src/compile/compile-service.js';
import { DeterministicRenderer } from '../packages/core/src/compile/deterministic-renderer.js';
import { CompileReturnDispatcherImpl } from '../packages/core/src/compile/compile-return-dispatcher.js';
import type { CompileReturnDispatcher } from '../packages/core/src/compile/compile-return-dispatcher.js';
// ── Core: compile-ref (AMEND-spec-nexus-compile §12) ────────────────────────
import { TemplateRegistryStoreImpl } from '../packages/core/src/compile/template-registry-store.js';
import { TemplateValidatorImpl } from '../packages/core/src/compile/template-schemas.js';
import {
  TemplateVerifierImpl,
  TemplateLoaderImpl,
} from '../packages/core/src/compile/template-loader.js';
import { DefaultTemplateGeneratorImpl } from '../packages/core/src/compile/default-template-generator.js';
import { SlotMatcherImpl } from '../packages/core/src/compile/slot-matcher.js';
import { SlotValidatorImpl } from '../packages/core/src/compile/slot-validator.js';
import type { EntityRefResolver } from '../packages/core/src/compile/slot-validator.js';
import { GuardEvaluatorImpl } from '../packages/core/src/compile/guard-evaluator.js';
import { DenialMarkerInserterImpl } from '../packages/core/src/compile/denial-marker-inserter.js';
import { CompileAssemblerImpl } from '../packages/core/src/compile/compile-assembler.js';
import { buildFormatRendererMap } from '../packages/core/src/compile/format-renderer.js';

// ── Core: externals (§4.8) ──────────────────────────────────────────────────
import { ExternalSocketRegistryImpl } from '../packages/core/src/externals/external-socket-registry.js';
import type { ExternalSocketRegistry } from '../packages/core/src/externals/external-socket-registry.js';

// ── Core: run ledger (§30) ──────────────────────────────────────────────────
import { JsonlRunLedgerWriter } from '../packages/core/src/ledger/run-ledger.js';
import { wrapWriterWithFanout } from '../packages/interfaces/api/src/routes/run-event-bus.js';

// ── Vanguard: transport layer (NISP-001.A) ───────────────────────────────────
import {
  ModelTransportAdapterRegistry,
  OllamaChatV1Adapter,
  AnthropicMessagesV1Adapter,
  OpenAiChatV1Adapter,
  EnvSecretSource,
  VaultSecretSource,
  ensureVaultKey,
  ChainedSecretSource,
  loadEndpointManifest,
  loadNvgRoutingPolicy,
  TierRegistry,
  NvgServiceImpl,
  JsonlRoutingTrailBackend,
} from '@nexus/vanguard';

// ── Runtime-utils: cross-domain collision detection (§14.6.4, §4.7) ─────────
import {
  detectCrossDomainCollisions,
  detectRequiredExternalsCollisions,
  type ManifestDomain,
} from '@nexus/runtime-utils';

// ── Node builtins ────────────────────────────────────────────────────────────
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';

// ── WS-BOOTSTRAP: workspace-ref (Layer 7) + identity-ref (Layer 6) ──────────
import {
  SqliteWorkspaceSessionStore,
  SqliteWorkspaceRunAclStore,
  SqliteWorkspaceEventTicketStore,
  SqliteWorkspaceFileStore,
  FilesystemWorkspaceBlobStore,
  SqlitePromptTemplateStore,
  SqliteSecureRailStore,
  ReferenceWorkspaceApprovalBridge,
  ReferenceElevatedAuthProvider,
  ReferenceCatalogReader,
} from '../packages/workspace-ref/src/index.js';
import {
  ReferenceIdentityAdapter,
  InMemoryActorStore,
  InMemoryPrincipalStore,
  ApiKeyAuthProvider,
  JwtAuthProvider,
} from '../packages/identity-ref/src/index.js';
import { FileBackedAdminSignerRegistry } from './admin-signer-registry.js';
import type {
  PendingApprovalStore,
  ApprovalResponse,
  WorkspaceSessionStorePort,
  WorkspaceRunAclStorePort,
  WorkspaceEventTicketStorePort,
  WorkspaceFileStorePort,
  WorkspaceBlobStorePort,
  PromptTemplateStorePort,
  SecureRailStorePort,
  AdminSignerRegistry,
  WorkspaceApprovalBridge,
  ElevatedAuthProvider,
  WorkspaceCatalogReaderPort,
  IdentityProviderInterface,
} from '@nexus/contracts';
import { CAPABILITY_IDS } from '@nexus/contracts';

// ── Manifest paths ───────────────────────────────────────────────────────────
// §32a.6 — original four domains
const MANIFEST_IDENTITY = 'config/identity/providers.v1.yaml';
const MANIFEST_CONNECTORS = 'config/connectors/connectors.v1.yaml';
const MANIFEST_CHANNELS = 'config/channels/channels.v1.yaml';
const MANIFEST_ENDPOINTS = 'config/nvg/endpoints.v1.yaml';
const NVG_ROUTING_POLICY = 'fixtures/nvg/default.routing-policy.yaml';
const MODE_CONFIG = 'keys/mode-config.json';
// CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — admin-managed API keys.
// Gitignored; created on first POST /workspace/admin/setup/secrets.
const SECRETS_FILE = 'keys/secrets.json';
// CLAUDE-CODE-VAULT-SECRET-SOURCE — AES-256-GCM key for at-rest encryption
// of secrets. Distinct from the Ed25519 control-plane key (different
// algorithm, different purpose). Gitignored; auto-generated on first run.
const VAULT_KEY_FILE = 'keys/vault.key';
// §5.1 — externals five domains
const MANIFEST_WORKSPACE = 'config/workspace/workspaces.v1.yaml';
const MANIFEST_ORCHESTRATORS = 'config/orchestrators/orchestrators.v1.yaml';
const MANIFEST_MAILBOX = 'config/mailbox/mailboxes.v1.yaml';
const MANIFEST_COMPILERS = 'config/compile/compilers.v1.yaml';
const MANIFEST_COMPILE_RETURN = 'config/output/compile-return.v1.yaml';
// Run ledger + output paths
//
// The run ledger is shared with the management-API serve command so that
// every writer (workspace dispatch, orchestrator coordinator, OutputCollector)
// appends to the same file. Without this, the OutputCollector's slot reader
// queries an empty ledger and rejects every mailbox write with
// UNDECLARED_OUTPUT_SLOT under strict_declared_slots policy.
const RUN_LEDGER_FILE =
  process.env['NEXUS_RUN_LEDGER_PATH'] ?? path.join('runs', 'infra.run-ledger.jsonl');
const COMPILE_OUTPUT_ROOT = 'runs';

// ── ExternalsRuntime — §5.2, bootstrap-owned, NOT in @nexus/contracts ───────

export interface ExternalsRuntime {
  // ── Manifest records (Claude C, SPEC-addendum-beta1-admin-dashboard §3.2) ──
  // Lifted into ExternalsRuntime so admin-setup routes can project them.
  // identity/connector/channel records lack `enabled` because their loaders
  // filter disabled rows out (HOLE-C01).
  readonly identityRecords: readonly IdentityProviderManifestRecord[];
  readonly connectorRecords: readonly ConnectorManifestRecord[];
  readonly channelRecords: readonly ChannelManifestRecord[];
  readonly workspaceSockets: readonly WorkspaceManifestRecord[];
  readonly orchestratorSockets: readonly OrchestratorManifestRecord[];
  readonly mailboxRecords: readonly MailboxManifestRecord[];
  readonly compilerRecords: readonly CompilerManifestRecord[];
  readonly compileReturnEndpoints: readonly CompileReturnEndpointRecord[];
  // ── Baked services ──
  readonly mailboxService: MailboxService;
  readonly outputCollector: OutputCollector;
  readonly compileService: CompileService;
  readonly compileReturnDispatcher: CompileReturnDispatcher;
  readonly socketRegistry: ExternalSocketRegistry;
  // ── Template admin route deps (AMEND-spec-nexus-compile §12) ──────────
  // Function-based — DIFF-S23-002: Layer 7 cannot import core types.
  readonly validateTemplate: (raw: unknown) => CompileTemplate;
  readonly verifyTemplate: (template: CompileTemplate) => Promise<void>;
  readonly storeTemplate: (template: CompileTemplate, ingestedBy: NonEmpty) => void;
  readonly templateExists: (templateId: NonEmpty, templateVersion: NonEmpty) => boolean;
}

// ── BootstrapResult — §5.2, expanded ────────────────────────────────────────

export interface BootstrapResult {
  readonly nvgService: NvgServiceImpl;
  readonly transportContext: NvgTransportContext;
  readonly tierRegistry: TierRegistry;
  readonly trailBackend: JsonlRoutingTrailBackend;
  readonly endpoints: readonly ModelEndpoint[];
  readonly controlPlanePublicKey: string;
  readonly routingPolicy: NvgRoutingPolicy;
  readonly modeConfig: ModeConfiguration;
  readonly externals: ExternalsRuntime;
  /**
   * Encryption-at-rest secret store for admin-managed API keys
   * (CLAUDE-CODE-VAULT-SECRET-SOURCE). Composition root adapts this into
   * the SecretWriter port for the admin secret routes; the read side is
   * already wired into transportContext.secretSource via ChainedSecretSource.
   * Values on disk are AES-256-GCM ciphertext keyed by `keys/vault.key`.
   */
  readonly vaultSecretSource: VaultSecretSource;
  /** Backing path of the secrets file — for evidence labels in the dashboard. */
  readonly secretsStorageLabel: string;
}

/**
 * Execute the 21-step bootstrap sequence.
 * Steps 1-12: §32a.6 (original NVG/NISP).
 * Steps 13-21: §5.1 (externals expansion).
 * Fail-closed: any step failure throws; Nexus does not start.
 */
export async function bootstrap(trailDir: string): Promise<BootstrapResult> {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEPS 1-12: ORIGINAL NVG/NISP BOOTSTRAP (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Step 1: Register factory registries + factories ─────────────────────
  // §12.3.48 invariant 3: all factories registered before any manifest loader runs.
  console.log('[bootstrap] Step 1: registering factory registries + factories');

  // 1a. Model transport adapter registry (§12.3.41)
  const adapterRegistry = new ModelTransportAdapterRegistry();
  adapterRegistry.register(new OllamaChatV1Adapter());
  adapterRegistry.register(new AnthropicMessagesV1Adapter());
  adapterRegistry.register(new OpenAiChatV1Adapter());

  // 1b. Identity provider factory registry (§12.3.45)
  const identityFactoryRegistry = new IdentityProviderFactoryRegistry();
  const riaFactory: IdentityProviderFactory = {
    providerType: 'reference_adapter' as NonEmpty,
    create: async (_config: Record<string, unknown>) => {
      throw new Error(
        'RIA identity provider construction is handled by the identity subsystem, ' +
          'not by the manifest loader. This code path should not be reached during bootstrap.'
      );
    },
  };
  identityFactoryRegistry.register(riaFactory);

  // 1c. Connector factory registry (§12.3.46)
  const connectorFactoryRegistry = new ConnectorFactoryRegistry();
  const stubConnectorFactory: ConnectorFactory = {
    connectorType: 'stub' as NonEmpty,
    create: async (_config: Record<string, unknown>) => {
      throw new Error(
        'Stub connector construction is handled by the connector subsystem, ' +
          'not by the manifest loader.'
      );
    },
  };
  connectorFactoryRegistry.register(stubConnectorFactory);

  // 1d. Approval channel factory registry (§12.3.47)
  const channelFactoryRegistry = new ApprovalChannelFactoryRegistry();
  const cliChannelFactory: ApprovalChannelFactory = {
    channelType: 'cli' as NonEmpty,
    create: async (_config: Record<string, unknown>) => {
      throw new Error(
        'CLI approval channel construction is handled by the approval subsystem, ' +
          'not by the manifest loader.'
      );
    },
  };
  channelFactoryRegistry.register(cliChannelFactory);

  // 1e. Workspace factory registry (§5.1)
  const workspaceFactoryRegistry = new WorkspaceFactoryRegistry();
  const refWorkspaceFactory: WorkspaceFactory = {
    workspaceType: 'reference_http' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Workspace construction deferred to API DI wiring.');
    },
  };
  workspaceFactoryRegistry.register(refWorkspaceFactory);

  // 1f. Orchestrator factory registry (§5.1)
  const orchestratorFactoryRegistry = new OrchestratorFactoryRegistry();
  const refOrchestratorFactory: OrchestratorFactory = {
    orchestratorType: 'reference_deterministic' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Orchestrator construction deferred to API DI wiring.');
    },
  };
  orchestratorFactoryRegistry.register(refOrchestratorFactory);

  // 1g. Mailbox backend factory registry (§5.1)
  const mailboxFactoryRegistry = new MailboxBackendFactoryRegistry();
  const refMailboxFactory: MailboxBackendFactory = {
    mailboxType: 'local_jsonl_reference' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Mailbox backend construction handled in Step 19.');
    },
  };
  mailboxFactoryRegistry.register(refMailboxFactory);

  // 1h. Compiler factory registry (§5.1)
  const compilerFactoryRegistry = new CompilerFactoryRegistry();
  const refCompilerFactory: CompilerFactory = {
    compilerType: 'reference_deterministic_renderer' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Compiler construction handled in Step 21.');
    },
  };
  compilerFactoryRegistry.register(refCompilerFactory);
  const customerCompilerFactory: CompilerFactory = {
    compilerType: 'customer_onprem_synthesis' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Customer compiler construction not implemented in reference harness.');
    },
  };
  compilerFactoryRegistry.register(customerCompilerFactory);

  // 1i. Compile-return transport factory registry (§5.1)
  const compileReturnTransportFactoryRegistry = new CompileReturnTransportFactoryRegistry();
  const httpCallbackTransportFactory: CompileReturnTransportFactory = {
    endpointType: 'http_callback' as NonEmpty,
    factoryVersion: '1.0.0' as NonEmpty,
    create: async () => {
      throw new Error('Transport construction handled in Step 21.');
    },
  };
  compileReturnTransportFactoryRegistry.register(httpCallbackTransportFactory);

  console.log(
    `[bootstrap] Step 1 complete: ` +
      `${adapterRegistry.list().length} adapters, ` +
      `${identityFactoryRegistry.list().length} identity, ` +
      `${connectorFactoryRegistry.list().length} connector, ` +
      `${channelFactoryRegistry.list().length} channel, ` +
      `${workspaceFactoryRegistry.list().length} workspace, ` +
      `${orchestratorFactoryRegistry.list().length} orchestrator, ` +
      `${mailboxFactoryRegistry.list().length} mailbox, ` +
      `${compilerFactoryRegistry.list().length} compiler, ` +
      `${compileReturnTransportFactoryRegistry.list().length} compile-return transport`
  );

  // ─── Step 2: Load control-plane keypair ──────────────────────────────────
  console.log('[bootstrap] Step 2: loading control-plane keypair');
  const controlPlaneKey = await loadControlPlaneKey();
  const pubKey = controlPlaneKey.publicKey;
  const privKey = controlPlaneKey.privateKey;
  console.log(`[bootstrap] Step 2 complete: public key ${pubKey.slice(0, 16)}...`);

  // ─── Step 2b: Ensure vault encryption key (CLAUDE-CODE-VAULT-SECRET-SOURCE) ──
  // Generates keys/vault.key on first run; idempotent thereafter. Must run
  // BEFORE Step 7 so VaultSecretSource.canResolve()/resolve() can read the
  // vault key during endpoint manifest loading.
  console.log(`[bootstrap] Step 2b: ensuring vault encryption key (${VAULT_KEY_FILE})`);
  const vaultKeyResult = await ensureVaultKey(path.join(process.cwd(), VAULT_KEY_FILE));
  if (vaultKeyResult.generated) {
    console.log('[bootstrap] vault key generated — fresh AES-256-GCM key written to disk');
  }
  console.log(
    `[bootstrap] Step 2b complete: vault key ${vaultKeyResult.generated ? 'created' : 'loaded'}`
  );

  // ─── Step 3: Load identity manifest ──────────────────────────────────────
  console.log(`[bootstrap] Step 3: loading identity manifest (${MANIFEST_IDENTITY})`);
  const identityRecords = await loadIdentityManifest({
    manifestPath: MANIFEST_IDENTITY,
    controlPlanePublicKey: pubKey,
    factoryRegistry: identityFactoryRegistry,
  });
  console.log(
    `[bootstrap] Step 3 complete: ${identityRecords.length} enabled identity provider(s)`
  );

  // ─── Step 4: Evaluate RIA bridge conditions (§32a.4) ─────────────────────
  console.log('[bootstrap] Step 4: evaluating RIA bridge conditions');
  if (process.env.NEXUS_RIA_LEGACY_BRIDGE === '1') {
    console.warn(
      '[bootstrap] WARNING: NEXUS_RIA_LEGACY_BRIDGE=1 detected. ' +
        'Legacy bridge is a transitional path only. ' +
        'Production deployments must use the signed identity manifest.'
    );
  }
  console.log('[bootstrap] Step 4 complete: RIA bridge conditions evaluated');

  // ─── Step 5: Load connector manifest ─────────────────────────────────────
  console.log(`[bootstrap] Step 5: loading connector manifest (${MANIFEST_CONNECTORS})`);
  const connectorRecords = await loadConnectorManifest({
    manifestPath: MANIFEST_CONNECTORS,
    controlPlanePublicKey: pubKey,
    factoryRegistry: connectorFactoryRegistry,
  });
  console.log(`[bootstrap] Step 5 complete: ${connectorRecords.length} enabled connector(s)`);

  // ─── Step 6: Load channel manifest ───────────────────────────────────────
  console.log(`[bootstrap] Step 6: loading channel manifest (${MANIFEST_CHANNELS})`);
  const channelRecords = await loadChannelManifest({
    manifestPath: MANIFEST_CHANNELS,
    controlPlanePublicKey: pubKey,
    factoryRegistry: channelFactoryRegistry,
  });
  console.log(`[bootstrap] Step 6 complete: ${channelRecords.length} enabled channel(s)`);

  // ─── Step 7: Load endpoint manifest ──────────────────────────────────────
  // CLAUDE-CODE-VAULT-SECRET-SOURCE: chained resolver — `file:` refs
  // resolve from keys/secrets.json (admin-managed at runtime via the
  // dashboard) with values authenticated-encrypted at rest under the vault
  // key from Step 2b; bare KEY refs fall back to process.env so existing
  // env-driven deployments keep working. Any plaintext values left over
  // from the pre-vault era are migrated in-place at first boot.
  console.log(`[bootstrap] Step 7: loading endpoint manifest (${MANIFEST_ENDPOINTS})`);
  const vaultSecretSource = new VaultSecretSource(
    path.join(process.cwd(), SECRETS_FILE),
    path.join(process.cwd(), VAULT_KEY_FILE)
  );
  const migration = await vaultSecretSource.migrateToEncrypted();
  if (migration.migrated > 0) {
    console.log(
      `[bootstrap] vault: encrypted ${migration.migrated} plaintext secret(s) ` +
        `(one-time migration from FileSecretSource format)`
    );
  }
  const envSecretSource = new EnvSecretSource();
  const secretSource = new ChainedSecretSource([vaultSecretSource, envSecretSource]);
  const endpoints = await loadEndpointManifest({
    manifestPath: MANIFEST_ENDPOINTS,
    controlPlanePublicKey: pubKey,
    adapterRegistry,
    secretSource,
  });
  console.log(`[bootstrap] Step 7 complete: ${endpoints.length} enabled endpoint(s)`);

  // ─── Cross-domain identifier collision check (§14.6.4, legacy NISP — warning-only) ──
  const domainIds = new Map<ManifestDomain, ReadonlySet<string>>();
  domainIds.set('identity', new Set(identityRecords.map(r => r.providerId)));
  domainIds.set('connector', new Set(connectorRecords.map(r => r.connectorId)));
  domainIds.set('channel', new Set(channelRecords.map(r => r.channelId)));
  domainIds.set('endpoint', new Set(endpoints.map(e => e.endpointId)));
  const collisionWarnings = detectCrossDomainCollisions(domainIds);
  for (const w of collisionWarnings) {
    console.warn('[bootstrap] WARNING: ' + w);
  }
  if (collisionWarnings.length > 0) {
    console.warn(
      '[bootstrap] ' +
        collisionWarnings.length +
        ' cross-domain collision(s) detected — review manifest IDs'
    );
  }

  // ─── Step 8: Populate TierRegistry from loaded endpoints ─────────────────
  console.log('[bootstrap] Step 8: populating TierRegistry');
  const tierRegistry = new TierRegistry();
  for (const ep of endpoints) {
    tierRegistry.registerEndpoint(ep);
  }
  console.log(`[bootstrap] Step 8 complete: ${endpoints.length} endpoint(s) in tier registry`);

  // ─── Step 9: Create NvgTransportContext ───────────────────────────────────
  console.log('[bootstrap] Step 9: creating NvgTransportContext');
  const transportContext: NvgTransportContext = {
    registry: adapterRegistry,
    secretSource,
  };
  console.log('[bootstrap] Step 9 complete: transport context wired');

  // ─── Step 10: Load NVG routing policy (§25.1) ────────────────────────────
  console.log(`[bootstrap] Step 10: loading NVG routing policy (${NVG_ROUTING_POLICY})`);
  const routingPolicy = await loadNvgRoutingPolicy(NVG_ROUTING_POLICY, pubKey, {
    verify,
    canonicalize,
  });
  console.log(
    `[bootstrap] Step 10 complete: policy ${routingPolicy.policyId} (${routingPolicy.rules.length} rules)`
  );

  // ─── Step 11: Load mode configuration (§9.2) ────────────────────────────
  console.log('[bootstrap] Step 11: loading mode configuration');
  let modeConfig: ModeConfiguration;
  try {
    modeConfig = await loadModeConfig(MODE_CONFIG);
  } catch {
    // MODE-002 ruling: observe/observe/unlocked default is intentional.
    console.log(
      '[bootstrap] Step 11: mode-config.json not found — creating default (observe/observe/unlocked per MODE-002)'
    );
    modeConfig = await createDefaultModeConfig('nexus-control-plane' as NonEmpty, controlPlaneKey);
    await saveModeConfig(modeConfig, MODE_CONFIG);
  }
  console.log(
    `[bootstrap] Step 11 complete: nxsMode=${modeConfig.nxsMode}, nvgMode=${modeConfig.nvgMode}`
  );

  // ─── Step 12: Construct NvgServiceImpl — fully wired (COMPOSE-002 fix) ──
  console.log('[bootstrap] Step 12: constructing NvgServiceImpl (wired)');
  const trailBackend = new JsonlRoutingTrailBackend(trailDir);
  const nvgService = new NvgServiceImpl({
    routingPolicy,
    tierRegistry,
    trailWriter: trailBackend,
    transportContext,
    modeConfig,
  });
  console.log('[bootstrap] Step 12 complete: NvgServiceImpl ready (5 deps wired)');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEPS 13-21: EXTERNALS EXPANSION (§5.1)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Step 13: Load workspace manifest ────────────────────────────────────
  console.log(`[bootstrap] Step 13: loading workspace manifest (${MANIFEST_WORKSPACE})`);
  const workspaceRecords = await loadWorkspaceManifest({
    manifestPath: MANIFEST_WORKSPACE,
    controlPlanePublicKey: pubKey,
    factoryRegistry: workspaceFactoryRegistry,
  });
  console.log(`[bootstrap] Step 13 complete: ${workspaceRecords.length} enabled workspace(s)`);

  // ─── Step 14: Load orchestrator manifest ─────────────────────────────────
  console.log(`[bootstrap] Step 14: loading orchestrator manifest (${MANIFEST_ORCHESTRATORS})`);
  const orchestratorRecords = await loadOrchestratorManifest({
    manifestPath: MANIFEST_ORCHESTRATORS,
    controlPlanePublicKey: pubKey,
    factoryRegistry: orchestratorFactoryRegistry,
  });
  console.log(
    `[bootstrap] Step 14 complete: ${orchestratorRecords.length} enabled orchestrator(s)`
  );

  // ─── Step 15: Load mailbox manifest ──────────────────────────────────────
  console.log(`[bootstrap] Step 15: loading mailbox manifest (${MANIFEST_MAILBOX})`);
  const mailboxRecords = await loadMailboxManifest({
    manifestPath: MANIFEST_MAILBOX,
    controlPlanePublicKey: pubKey,
    factoryRegistry: mailboxFactoryRegistry,
  });
  console.log(`[bootstrap] Step 15 complete: ${mailboxRecords.length} enabled mailbox(es)`);

  // ─── Step 16: Load compiler manifest ─────────────────────────────────────
  console.log(`[bootstrap] Step 16: loading compiler manifest (${MANIFEST_COMPILERS})`);
  const compilerRecords = await loadCompilerManifest({
    manifestPath: MANIFEST_COMPILERS,
    controlPlanePublicKey: pubKey,
    factoryRegistry: compilerFactoryRegistry,
  });
  console.log(`[bootstrap] Step 16 complete: ${compilerRecords.length} enabled compiler(s)`);

  // ─── Step 17: Load compile-return manifest ───────────────────────────────
  console.log(`[bootstrap] Step 17: loading compile-return manifest (${MANIFEST_COMPILE_RETURN})`);
  const compileReturnRecords = await loadCompileReturnManifest({
    manifestPath: MANIFEST_COMPILE_RETURN,
    controlPlanePublicKey: pubKey,
    factoryRegistry: compileReturnTransportFactoryRegistry,
  });
  console.log(
    `[bootstrap] Step 17 complete: ${compileReturnRecords.length} enabled compile-return endpoint(s)`
  );

  // ─── Step 18: Cross-domain collision + cross-reference validation (§4.7) ─
  console.log(
    '[bootstrap] Step 18: running required-domain collision + cross-reference validation'
  );

  // Add externals domains to the collision map
  domainIds.set('workspace', new Set(workspaceRecords.map(r => r.workspaceSocketId)));
  domainIds.set('orchestrator', new Set(orchestratorRecords.map(r => r.orchestratorSocketId)));
  domainIds.set('mailbox', new Set(mailboxRecords.map(r => r.mailboxId)));
  domainIds.set('compiler', new Set(compilerRecords.map(r => r.compilerSocketId)));
  domainIds.set('compileReturn', new Set(compileReturnRecords.map(r => r.returnEndpointId)));

  // Required externals collision — fail closed (§4.7)
  const extCollisionErrors = detectRequiredExternalsCollisions(domainIds);
  if (extCollisionErrors.length > 0) {
    throw new Error(
      `[bootstrap] Step 18 FAILED — required externals collisions:\n  ${extCollisionErrors.join('\n  ')}`
    );
  }

  // Run ledger writer for ExternalSocketRegistry. Wrapped with the SSE
  // event bus so OutputCollector + reference compile chain events
  // (partial_result, compile_started, compile_mode_selected, etc.) reach
  // any subscribed SSE client for the run. Without this, only events
  // written via the serve-owned writer (workspace + orchestrator) would
  // fan out, leaving the browser missing the post-dispatch lifecycle.
  const runLedgerWriter = wrapWriterWithFanout(new JsonlRunLedgerWriter(RUN_LEDGER_FILE));

  // Build ExternalSocketRegistry early for cross-reference validation
  const socketRegistry = new ExternalSocketRegistryImpl({
    workspaces: workspaceRecords,
    orchestrators: orchestratorRecords,
    mailboxes: mailboxRecords,
    compilers: compilerRecords,
    compileReturnEndpoints: compileReturnRecords,
    runLedgerWriter,
  });

  // Cross-reference validation — fail closed (§4.7)
  socketRegistry.validateCrossReferences();

  console.log('[bootstrap] Step 18 complete: no collisions, cross-references valid');

  // ─── Step 19: Construct MailboxBackend + baked MailboxService ─────────────
  console.log('[bootstrap] Step 19: constructing MailboxBackend + MailboxService');
  const primaryMailbox = socketRegistry.getPrimaryMailbox();
  const mailboxBackend = new LocalJsonlMailboxBackend(primaryMailbox.storageRoot);
  const mailboxService = new MailboxServiceImpl(mailboxBackend, primaryMailbox);
  console.log(
    `[bootstrap] Step 19 complete: mailbox '${primaryMailbox.mailboxId}' (${primaryMailbox.mailboxType})`
  );

  // ─── Step 20: Construct ExternalSocketRegistry, DeclaredOutputSlotReader, ─
  //              PayloadResolver set, OutputCollector
  console.log('[bootstrap] Step 20: constructing output infrastructure');

  const slotReader = new RunLedgerSlotReader(runLedgerWriter);

  // PayloadResolver — reference file:// resolver
  const payloadResolverRegistry = new PayloadResolverRegistryImpl();
  const fileResolver: PayloadResolver = {
    resolverId: 'file-local' as NonEmpty,
    resolverVersion: '1.0.0' as NonEmpty,
    canResolve: (ref: NonEmpty) => (ref as string).startsWith('file://'),
    resolveBytes: async (ref: NonEmpty) => {
      const filePath = (ref as string).replace('file://', '');
      const resolved = path.resolve(filePath);
      const buf = await fs.readFile(resolved);
      return new Uint8Array(buf);
    },
  };
  payloadResolverRegistry.register(fileResolver);

  // Determine output slot policy from first enabled orchestrator
  const primaryOrchestrator = orchestratorRecords[0];
  const outputSlotPolicy = primaryOrchestrator
    ? primaryOrchestrator.outputSlotPolicy
    : ('open_slots' as const);

  const outputCollector = new OutputCollectorImpl({
    mailboxService,
    mailboxId: primaryMailbox.mailboxId,
    resolverRegistry: payloadResolverRegistry,
    slotReader,
    ledgerWriter: runLedgerWriter,
    outputSlotPolicy,
    expiresAt: null,
  });

  console.log('[bootstrap] Step 20 complete: OutputCollector wired');

  // ─── Step 21: Construct CompileService, CompileReturnDispatcher, ──────────
  //              reference deterministic compiler, assemble ExternalsRuntime
  console.log('[bootstrap] Step 21: constructing compile infrastructure + ExternalsRuntime');

  const defaultCompiler = socketRegistry.getDefaultCompiler();

  // ── Compile-ref infrastructure (AMEND-spec-nexus-compile §12) ─────────

  // 1. Template registry store — SQLite Zone 1
  const templateDbPath = process.env['NEXUS_DB_PATH'] ?? path.join(process.cwd(), 'nexus.db');
  const templateDb = new Database(templateDbPath);
  const templateStore = new TemplateRegistryStoreImpl(templateDb);
  templateStore.initialize();

  // 2. Template validator (Zod + structural)
  const templateValidator = new TemplateValidatorImpl();

  // 3. Template verifier (Ed25519 + digest)
  const templateVerifier = new TemplateVerifierImpl(pubKey);

  // 4. Template loader (store + verifier)
  const templateLoader = new TemplateLoaderImpl(templateStore, templateVerifier);

  // 5. Default template generator (sync Ed25519 signing)
  const defaultTemplateGenerator = new DefaultTemplateGeneratorImpl(privKey);

  // 6. Slot matcher
  const slotMatcher = new SlotMatcherImpl();

  // 7. Slot validator + V1 entity ref resolver
  const entityRefResolver: EntityRefResolver = {
    async resolve(_registry, _entityId) {
      // V1: reference implementation — always resolves true.
      // Production: wire to actual actor/principal/system registries.
      return true;
    },
  };
  const slotValidator = new SlotValidatorImpl(entityRefResolver);

  // 8. Guard evaluator
  const guardEvaluator = new GuardEvaluatorImpl();

  // 9. Denial marker inserter
  const denialMarkerInserter = new DenialMarkerInserterImpl();

  // 10. Format renderers
  const formatRenderers = buildFormatRendererMap();

  // 11. Compile assembler
  const compileAssembler = new CompileAssemblerImpl(
    slotMatcher,
    slotValidator,
    guardEvaluator,
    formatRenderers,
    denialMarkerInserter
  );

  // 12. Payload resolver array for DeterministicRenderer
  const payloadResolvers: PayloadResolver[] = [fileResolver];

  // Reference deterministic renderer — actor-registration exempt
  const deterministicRenderer = new DeterministicRenderer(
    defaultCompiler.compilerSocketId,
    privKey,
    COMPILE_OUTPUT_ROOT,
    templateLoader,
    defaultTemplateGenerator,
    compileAssembler,
    payloadResolvers,
    runLedgerWriter
  );

  // CompileService — selects compile mode and invokes compiler
  const compileConfig: CompileConfig = { preferFrontierSynthesis: false };
  const compileService = new CompileServiceImpl(
    deterministicRenderer,
    defaultCompiler,
    compileConfig,
    runLedgerWriter
  );

  // Reference http_callback transport — simple HTTP POST
  const httpCallbackTransport: CompileReturnTransport = {
    endpointType: 'http_callback' as NonEmpty,
    transportVersion: '1.0.0' as NonEmpty,
    send: async (
      endpoint: CompileReturnEndpointRecord,
      request: CompileReturnRequest
    ): Promise<CompileReturnAck> => {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(
          `Compile-return HTTP callback to '${endpoint.url}' failed: ${response.status}`
        );
      }
      const body = (await response.json()) as { ok: boolean; data: CompileReturnAck };
      return body.data;
    },
  };

  // CompileReturnDispatcher — signed callback dispatch
  const compileReturnDispatcher = new CompileReturnDispatcherImpl({
    resolveTransport: (endpointType: string) =>
      endpointType === 'http_callback' ? httpCallbackTransport : null,
    signingPrivateKey: privKey,
    keyId: 'nexus-control-plane' as NonEmpty,
  });

  // 13. Template admin route function bindings (DIFF-S23-002 — function sigs only)
  // Wraps core implementations into function signatures that Layer 7 can consume
  // without importing core types.
  const validateTemplateFn = (raw: unknown): CompileTemplate =>
    templateValidator.validateForIngestion(raw);
  const verifyTemplateFn = async (template: CompileTemplate): Promise<void> => {
    await templateVerifier.verifyOrThrow(template);
  };
  const storeTemplateFn = (template: CompileTemplate, ingestedBy: NonEmpty): void => {
    templateStore.ingest(template, ingestedBy);
  };
  const templateExistsFn = (templateId: NonEmpty, templateVersion: NonEmpty): boolean =>
    templateStore.exists(templateId, templateVersion);

  // Assemble ExternalsRuntime (§5.2)
  const externals: ExternalsRuntime = {
    // Manifest records (Claude C — admin-setup projection inputs)
    identityRecords,
    connectorRecords,
    channelRecords,
    workspaceSockets: workspaceRecords,
    orchestratorSockets: orchestratorRecords,
    mailboxRecords,
    compilerRecords,
    compileReturnEndpoints: compileReturnRecords,
    // Baked services
    mailboxService,
    outputCollector,
    compileService,
    compileReturnDispatcher,
    socketRegistry,
    validateTemplate: validateTemplateFn,
    verifyTemplate: verifyTemplateFn,
    storeTemplate: storeTemplateFn,
    templateExists: templateExistsFn,
  };

  console.log('[bootstrap] Step 21 complete: ExternalsRuntime assembled');
  console.log('\n[bootstrap] ══ All 21 steps complete — Nexus is ready ══\n');

  return {
    nvgService,
    transportContext,
    tierRegistry,
    trailBackend,
    endpoints,
    controlPlanePublicKey: pubKey,
    routingPolicy,
    modeConfig,
    externals,
    vaultSecretSource,
    secretsStorageLabel: SECRETS_FILE,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WS-BOOTSTRAP — workspace composition-root wiring
// Governing law: WS-BOOTSTRAP micro-spec (owner-ratified)
// DIFF-WSBOOT-001: factory takes 3 core deps (not zero-arg) because
//   the bridge MUST share core's PendingApprovalStore instance.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Core deps that the workspace bootstrap needs from the serve command.
 * These are contract-level types, not concrete implementations.
 */
export interface WorkspaceBootstrapCoreDeps {
  /** Core PendingApprovalStore — shared with NXS pipeline */
  approvalStore: PendingApprovalStore;
  /** Core decideApproval — single signing/resolution path */
  decideApproval: (
    approvalId: string,
    decidedBy: string,
    decision: 'approved' | 'denied',
    note: string | undefined,
    store: PendingApprovalStore
  ) => Promise<ApprovalResponse>;
  /** Resolve principalId → approverId. Null = not a registered approver. */
  loadApproverKey: (principalId: string) => Promise<string | null>;
  // ORCH-WIRE-001: canonical stores
  actorRegistry: ActorRegistry;
  principalRegistry: PrincipalRegistry;
}

/**
 * Optional catalog data sources for the reference catalog reader.
 * Claude C / SPEC-addendum-beta1-admin-dashboard §3.2: when supplied, the
 * catalog reader emits claims-filtered listings; when omitted, it returns
 * empty arrays (preserves prior zero-arg behavior).
 */
export interface WorkspaceBootstrapCatalogSources {
  readonly connectorRecords?: readonly ConnectorManifestRecord[];
  readonly endpointRecords?: readonly ModelEndpoint[];
}

/**
 * Workspace API deps returned by bootstrapWorkspace.
 * Narrow Pick — not a generic override bag.
 */
export interface WorkspaceApiDeps {
  workspaceSessionStore: WorkspaceSessionStorePort;
  workspaceRunAclStore: WorkspaceRunAclStorePort;
  workspaceEventTicketStore: WorkspaceEventTicketStorePort;
  workspaceFileStore: WorkspaceFileStorePort;
  workspaceBlobStore: WorkspaceBlobStorePort;
  promptTemplateStore: PromptTemplateStorePort;
  secureRailStore: SecureRailStorePort;
  workspaceApprovalBridge: WorkspaceApprovalBridge;
  elevatedAuthProvider: ElevatedAuthProvider;
  catalogReader: WorkspaceCatalogReaderPort;
  adminSignerRegistry: AdminSignerRegistry;
  verifySignature: (payload: string, signature: string, publicKey: string) => Promise<boolean>;
  workspaceJwtSecret?: string;
  identityProvider: IdentityProviderInterface;
}

/**
 * Construct all workspace reference implementations.
 * All @nexus/workspace-ref imports are here (composition root).
 * API and CLI never import workspace-ref directly.
 *
 * Env vars:
 *   NEXUS_WORKSPACE_DB_PATH    default: runs/workspace-ref.sqlite
 *   NEXUS_WORKSPACE_BLOB_DIR   default: runs/workspace-blobs
 *   NEXUS_WORKSPACE_JWT_SECRET no default; missing = fail-closed (501)
 */
export async function bootstrapWorkspace(
  coreDeps: WorkspaceBootstrapCoreDeps,
  catalogSources?: WorkspaceBootstrapCatalogSources
): Promise<WorkspaceApiDeps> {
  const wsDbPath =
    process.env['NEXUS_WORKSPACE_DB_PATH'] ??
    path.join(process.cwd(), 'runs', 'workspace-ref.sqlite');
  const blobDir =
    process.env['NEXUS_WORKSPACE_BLOB_DIR'] ?? path.join(process.cwd(), 'runs', 'workspace-blobs');
  // Load JWT secret: file primary, env override [T8-F02, T16-F02 closure]
  const jwtSecret = await loadWorkspaceJwtSecret();

  // ── Workspace stores (all open their own SQLite connections with WAL) ────
  const workspaceSessionStore = new SqliteWorkspaceSessionStore(wsDbPath);
  const workspaceRunAclStore = new SqliteWorkspaceRunAclStore(wsDbPath);
  const workspaceEventTicketStore = new SqliteWorkspaceEventTicketStore(wsDbPath);
  const workspaceFileStore = new SqliteWorkspaceFileStore(wsDbPath);
  const workspaceBlobStore = new FilesystemWorkspaceBlobStore(blobDir);
  const promptTemplateStore = new SqlitePromptTemplateStore(wsDbPath);
  const secureRailStore = new SqliteSecureRailStore(wsDbPath);

  // ── Elevated auth + catalog (reference implementations) ─────────────────
  const elevatedAuthProvider = new ReferenceElevatedAuthProvider({ dbPath: wsDbPath });
  // Claude C: claims-filtered catalog reader. Backward-compat — omitted
  // catalogSources yields empty listings, matching prior zero-arg behavior.
  const catalogReader = new ReferenceCatalogReader({
    actorRegistry: coreDeps.actorRegistry,
    ...(catalogSources?.connectorRecords !== undefined
      ? { connectorRecords: catalogSources.connectorRecords }
      : {}),
    ...(catalogSources?.endpointRecords !== undefined
      ? { endpointRecords: catalogSources.endpointRecords }
      : {}),
  });

  // ── Admin signer registry (file-backed, keys/admins/<signerId>.public.json) ─
  const adminSignerRegistry = new FileBackedAdminSignerRegistry();

  // ── Signature verification — real Ed25519 via core verify() ─────────────
  // Hard rule 32: admin signers ≠ approver keys
  const verifySignatureFn = async (
    payload: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> => {
    return verify(payload, signature, publicKey);
  };

  // ── Approval bridge — wired with core deps (shared PendingApprovalStore) ─
  // RunAcl alone never authorizes approval decisions.
  const workspaceApprovalBridge = new ReferenceWorkspaceApprovalBridge({
    approvalStore: coreDeps.approvalStore,
    decideApproval: coreDeps.decideApproval,
    loadApproverKey: coreDeps.loadApproverKey,
  });

  // ── ORCH-WIRE-001: Identity provider backed by canonical NXS ActorRegistry ──
  const canonicalActorAdapter: import('../packages/identity-ref/src/actor-store.js').ReferenceActorStore =
    {
      async get(actorIdentifier) {
        const actor = await coreDeps.actorRegistry.get(actorIdentifier as Uuid);
        if (!actor) return null;
        return {
          actorId: actor.actorId,
          actorClass: actor.actorClass,
          principalId: actor.principalId,
          environment: actor.environment,
          riskCeiling: actor.riskCeiling,
          allowedSystems: actor.allowedSystems,
          allowedCapabilities: actor.allowedCapabilities ?? [],
          roles: ['admin'], // HOLE-A02 temp: master-key seed; per-actor roles pending Layer-2 ratification
          ...(actor.owner !== undefined ? { owner: actor.owner } : {}),
          ...(actor.purpose !== undefined ? { purpose: actor.purpose } : {}),
          ...(actor.reviewCadence !== undefined ? { reviewCadence: actor.reviewCadence } : {}),
        };
      },
      async register() {
        throw new Error('Use actorRegistry.register() — adapter is read-only');
      },
    };
  const canonicalPrincipalAdapter: import('../packages/identity-ref/src/principal-store.js').ReferencePrincipalStore =
    {
      async get(principalId) {
        return coreDeps.principalRegistry.get(principalId);
      },
      async register() {
        throw new Error('Use principalRegistry.register() — adapter is read-only');
      },
    };

  const authProvider = new ApiKeyAuthProvider();
  const jwtAuthProvider = jwtSecret ? new JwtAuthProvider(jwtSecret) : undefined;
  const identityProvider = new ReferenceIdentityAdapter(
    canonicalActorAdapter,
    canonicalPrincipalAdapter,
    authProvider,
    jwtAuthProvider
  );

  // ── Seed dev-admin + default agent in canonical NXS ActorRegistry ──────
  const devAdminApiKey = await loadDevAdminApiKey();
  if (devAdminApiKey) {
    const DEV_ADMIN_PRINCIPAL_ID = '00000000-0000-4000-a000-000000000001' as Uuid;
    const DEV_ADMIN_ACTOR_ID = '00000000-0000-4000-a000-000000000002' as Uuid;
    const DEFAULT_AGENT_PRINCIPAL_ID = '00000000-0000-4000-a000-000000000003' as Uuid;
    const DEFAULT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004' as Uuid;
    const now = new Date().toISOString();

    // Concrete authority lists for dev-admin — no wildcards anywhere. The
    // delegation engine and planner do strict subset/equality checks, so a
    // literal '*' silently fails closed (system_not_in_principal_scope at mint
    // time, capability_outside_ceiling at plan time). Enumerate explicitly.
    const DEV_ADMIN_SYSTEMS: string[] = ['stub'];
    const DEV_ADMIN_CAPABILITIES: string[] = Object.values(CAPABILITY_IDS);

    if (!(await coreDeps.principalRegistry.get(DEV_ADMIN_PRINCIPAL_ID))) {
      await coreDeps.principalRegistry.register({
        principalId: DEV_ADMIN_PRINCIPAL_ID,
        displayName: 'dev-admin' as NonEmpty,
        email: 'dev-admin@nexus.local' as NonEmpty,
        registeredAt: now,
        maxDelegableRiskTier: 'critical',
        allowedSystems: DEV_ADMIN_SYSTEMS,
      });
    }
    if (!(await coreDeps.actorRegistry.get(DEV_ADMIN_ACTOR_ID))) {
      await coreDeps.actorRegistry.register({
        actorId: DEV_ADMIN_ACTOR_ID,
        actorClass: 'HUMAN',
        principalId: DEV_ADMIN_PRINCIPAL_ID,
        displayName: 'dev-admin' as NonEmpty,
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'critical',
        allowedSystems: DEV_ADMIN_SYSTEMS,
        allowedCapabilities: DEV_ADMIN_CAPABILITIES,
        enabled: true,
        registeredAt: now,
        owner: 'system' as NonEmpty,
        purpose: 'Reference bootstrap admin' as NonEmpty,
        reviewCadence: 'quarterly' as NonEmpty,
      } as Actor);
    }
    authProvider.registerKey(devAdminApiKey, DEV_ADMIN_ACTOR_ID);

    if (!(await coreDeps.principalRegistry.get(DEFAULT_AGENT_PRINCIPAL_ID))) {
      await coreDeps.principalRegistry.register({
        principalId: DEFAULT_AGENT_PRINCIPAL_ID,
        displayName: 'nexus-default-agent-svc' as NonEmpty,
        email: 'agent@nexus.local' as NonEmpty,
        registeredAt: now,
        maxDelegableRiskTier: 'medium',
        allowedSystems: ['stub'],
      });
    }
    if (!(await coreDeps.actorRegistry.get(DEFAULT_AGENT_ACTOR_ID))) {
      await coreDeps.actorRegistry.register({
        actorId: DEFAULT_AGENT_ACTOR_ID,
        actorClass: 'SUPERVISED_AGENT',
        principalId: DEFAULT_AGENT_PRINCIPAL_ID,
        displayName: 'nexus-default-agent' as NonEmpty,
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'medium',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single', 'search:data', 'synthesize:content'],
        enabled: true,
        registeredAt: now,
        owner: 'system' as NonEmpty,
        purpose: 'Default supervised agent for reference deployment' as NonEmpty,
        reviewCadence: 'quarterly' as NonEmpty,
      } as Actor);
    }
    console.log('[workspace-bootstrap] dev-admin + default-agent seeded (canonical NXS store)');

    // ── SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §7.1: bounded test users ──
    // Seed two non-admin principals + matching HUMAN actors so the runtime
    // delegation fix can be exercised end-to-end (ceiling intersection,
    // lesser-of risk tier).
    const TEST_PRINCIPAL_1 = '00000000-0000-4000-a000-000000000010' as Uuid;
    const TEST_ACTOR_1 = '00000000-0000-4000-a000-000000000011' as Uuid;
    if (!(await coreDeps.principalRegistry.get(TEST_PRINCIPAL_1))) {
      await coreDeps.principalRegistry.register({
        principalId: TEST_PRINCIPAL_1,
        displayName: 'test-analyst' as NonEmpty,
        email: 'analyst@nexus.local' as NonEmpty,
        registeredAt: now,
        maxDelegableRiskTier: 'medium',
        allowedSystems: ['stub'],
      });
    }
    if (!(await coreDeps.actorRegistry.get(TEST_ACTOR_1))) {
      await coreDeps.actorRegistry.register({
        actorId: TEST_ACTOR_1,
        actorClass: 'HUMAN',
        principalId: TEST_PRINCIPAL_1,
        displayName: 'test-analyst' as NonEmpty,
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'medium',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single', 'search:data', 'synthesize:content'],
        enabled: true,
        registeredAt: now,
        owner: 'system' as NonEmpty,
        purpose: 'Bounded test user for delegation testing' as NonEmpty,
        reviewCadence: 'quarterly' as NonEmpty,
      } as Actor);
    }

    const TEST_PRINCIPAL_2 = '00000000-0000-4000-a000-000000000020' as Uuid;
    const TEST_ACTOR_2 = '00000000-0000-4000-a000-000000000021' as Uuid;
    if (!(await coreDeps.principalRegistry.get(TEST_PRINCIPAL_2))) {
      await coreDeps.principalRegistry.register({
        principalId: TEST_PRINCIPAL_2,
        displayName: 'test-intern' as NonEmpty,
        email: 'intern@nexus.local' as NonEmpty,
        registeredAt: now,
        maxDelegableRiskTier: 'low',
        allowedSystems: ['stub'],
      });
    }
    if (!(await coreDeps.actorRegistry.get(TEST_ACTOR_2))) {
      await coreDeps.actorRegistry.register({
        actorId: TEST_ACTOR_2,
        actorClass: 'HUMAN',
        principalId: TEST_PRINCIPAL_2,
        displayName: 'test-intern' as NonEmpty,
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'low',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single'],
        enabled: true,
        registeredAt: now,
        owner: 'system' as NonEmpty,
        purpose: 'Low-privilege test user for ceiling intersection testing' as NonEmpty,
        reviewCadence: 'quarterly' as NonEmpty,
      } as Actor);
    }
    console.log(
      '[workspace-bootstrap] test-analyst (medium) + test-intern (low) seeded for delegation tests'
    );
  } else {
    console.log('[workspace-bootstrap] dev-admin key not found — run nexus init');
  }

  console.log('[workspace-bootstrap] Workspace reference stores constructed');
  console.log(`  DB: ${wsDbPath}`);
  console.log(`  Blobs: ${blobDir}`);
  console.log(`  JWT secret: ${jwtSecret ? 'configured' : 'NOT SET (fail-closed)'}`);

  return {
    workspaceSessionStore,
    workspaceRunAclStore,
    workspaceEventTicketStore,
    workspaceFileStore,
    workspaceBlobStore,
    promptTemplateStore,
    secureRailStore,
    workspaceApprovalBridge,
    elevatedAuthProvider,
    catalogReader,
    adminSignerRegistry,
    verifySignature: verifySignatureFn,
    ...(jwtSecret !== undefined ? { workspaceJwtSecret: jwtSecret } : {}),
    identityProvider,
  };
}
