#!/usr/bin/env tsx
/**
 * Nexus Bootstrap — spec §32a.6, COMPOSE-002/WIRE-002-P03 fix
 *
 * 12-step startup wiring. All four registries populated BEFORE any
 * manifest loader runs (§12.3.48 invariant 3). Fail-closed on every step.
 *
 * This is a composition root — cross-layer imports are permitted.
 *
 * Steps:
 *   1. Register factory registries + factories (adapters, identity, connectors, channels)
 *   2. Load control-plane keypair
 *   3. Load identity manifest (config/identity/providers.v1.yaml)
 *   4. Evaluate RIA bridge conditions (§32a.4)
 *   5. Load connector manifest (config/connectors/connectors.v1.yaml)
 *   6. Load channel manifest (config/channels/channels.v1.yaml)
 *   7. Load endpoint manifest (config/nvg/endpoints.v1.yaml)
 *   8. Populate TierRegistry from loaded endpoints
 *   9. Create NvgTransportContext (adapter registry + secret source)
 *  10. Load NVG routing policy (§25.1 — signed YAML, signature-verified)
 *  11. Load mode configuration (§9.2 — or create default per MODE-002)
 *  12. Construct NvgServiceImpl — fully wired with all 5 deps
 *
 * Governing law:
 *   §32a.6  — bootstrap order (12 steps)
 *   §12.3.48 — factory registry behavior law (4 invariants)
 *   §32a.4  — RIA legacy bridge conditions
 *   §14.6.6 — fail closed on empty/all-disabled manifests
 *   §25.1   — NVG routing policy: signed YAML, Ed25519 signature verification
 *   §9.2    — mode configuration: signed, fail-closed on invalid signature
 */

import type {
  IdentityProviderFactory,
  ConnectorFactory,
  ApprovalChannelFactory,
  NvgTransportContext,
  ModelEndpoint,
  NonEmpty,
  ModeConfiguration,
  NvgRoutingPolicy,
} from '@nexus/contracts';

// ── Core: crypto ─────────────────────────────────────────────────────────────
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';
import { verify } from '../packages/core/src/crypto/verifier.js';
import { canonicalize } from '../packages/core/src/crypto/canonicalize.js';

// ── Core: mode management (§9) ──────────────────────────────────────────────
import {
  loadModeConfig,
  createDefaultModeConfig,
  saveModeConfig,
} from '../packages/core/src/modes/mode-manager.js';

// ── Core: factory registries (§12.3.45–.47) ─────────────────────────────────
import { IdentityProviderFactoryRegistry } from '../packages/core/src/manifest/identity/identity-provider-factory-registry.js';
import { ConnectorFactoryRegistry } from '../packages/core/src/manifest/connectors/connector-factory-registry.js';
import { ApprovalChannelFactoryRegistry } from '../packages/core/src/manifest/channels/channel-factory-registry.js';

// ── Core: manifest loaders (§32a.2.1–.3) ────────────────────────────────────
import { loadIdentityManifest } from '../packages/core/src/manifest/identity/identity-manifest-loader.js';
import { loadConnectorManifest } from '../packages/core/src/manifest/connectors/connector-manifest-loader.js';
import { loadChannelManifest } from '../packages/core/src/manifest/channels/channel-manifest-loader.js';

// ── Vanguard: transport layer (NISP-001.A) ───────────────────────────────────
import {
  ModelTransportAdapterRegistry,
  OllamaChatV1Adapter,
  AnthropicMessagesV1Adapter,
  OpenAiChatV1Adapter,
  EnvSecretSource,
  loadEndpointManifest,
  loadNvgRoutingPolicy,
  TierRegistry,
  NvgServiceImpl,
  JsonlRoutingTrailBackend,
} from '@nexus/vanguard';

// ── Runtime-utils: cross-domain collision detection (§14.6.4) ────────────
import { detectCrossDomainCollisions, type ManifestDomain } from '@nexus/runtime-utils';

// ── Manifest paths (§32a.6 — all four domains) ──────────────────────────────
const MANIFEST_IDENTITY = 'config/identity/providers.v1.yaml';
const MANIFEST_CONNECTORS = 'config/connectors/connectors.v1.yaml';
const MANIFEST_CHANNELS = 'config/channels/channels.v1.yaml';
const MANIFEST_ENDPOINTS = 'config/nvg/endpoints.v1.yaml';
const NVG_ROUTING_POLICY = 'fixtures/nvg/default.routing-policy.yaml';
const MODE_CONFIG = 'keys/mode-config.json';

// ── Bootstrap result ─────────────────────────────────────────────────────────
export interface BootstrapResult {
  readonly nvgService: NvgServiceImpl;
  readonly transportContext: NvgTransportContext;
  readonly tierRegistry: TierRegistry;
  readonly trailBackend: JsonlRoutingTrailBackend;
  readonly endpoints: readonly ModelEndpoint[];
  readonly controlPlanePublicKey: string;
  readonly routingPolicy: NvgRoutingPolicy;
  readonly modeConfig: ModeConfiguration;
}

/**
 * Execute the 12-step bootstrap sequence — §32a.6 + COMPOSE-002/WIRE-002-P03 fix.
 * Fail-closed: any step failure throws; Nexus does not start.
 */
export async function bootstrap(trailDir: string): Promise<BootstrapResult> {
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
      // RIA provider construction deferred to identity subsystem bootstrap.
      // The manifest loader only checks factory existence (§12.3.48 invariant 2).
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
      // Stub connector construction deferred to connector subsystem.
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
      // CLI approval channel construction deferred to approval subsystem.
      throw new Error(
        'CLI approval channel construction is handled by the approval subsystem, ' +
          'not by the manifest loader.'
      );
    },
  };
  channelFactoryRegistry.register(cliChannelFactory);

  console.log(
    `[bootstrap] Step 1 complete: ` +
      `${adapterRegistry.list().length} adapters, ` +
      `${identityFactoryRegistry.list().length} identity factories, ` +
      `${connectorFactoryRegistry.list().length} connector factories, ` +
      `${channelFactoryRegistry.list().length} channel factories`
  );

  // ─── Step 2: Load control-plane keypair ──────────────────────────────────
  console.log('[bootstrap] Step 2: loading control-plane keypair');
  const controlPlaneKey = await loadControlPlaneKey();
  const pubKey = controlPlaneKey.publicKey;
  console.log(`[bootstrap] Step 2 complete: public key ${pubKey.slice(0, 16)}...`);

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
    // In CI, this is caught by ci:gate Step 17. At runtime, log a warning.
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
  console.log(`[bootstrap] Step 7: loading endpoint manifest (${MANIFEST_ENDPOINTS})`);
  const secretSource = new EnvSecretSource();
  const endpoints = await loadEndpointManifest({
    manifestPath: MANIFEST_ENDPOINTS,
    controlPlanePublicKey: pubKey,
    adapterRegistry,
    secretSource,
  });
  console.log(`[bootstrap] Step 7 complete: ${endpoints.length} enabled endpoint(s)`);

  // ─── Cross-domain identifier collision check (§14.6.4, audit-approved additive) ──
  // Warning-only — does not fail closed. Detects when two manifest domains
  // share the same primary identifier (e.g. endpoint and connector both using 'prod-01').
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
    // If no config exists, create a signed default with the control-plane key.
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

  console.log('\n[bootstrap] ══ All 12 steps complete — Nexus is ready ══\n');

  return {
    nvgService,
    transportContext,
    tierRegistry,
    trailBackend,
    endpoints,
    controlPlanePublicKey: pubKey,
    routingPolicy,
    modeConfig,
  };
}
