#!/usr/bin/env tsx
/**
 * Nexus Bootstrap — spec §32a.6
 *
 * 10-step startup wiring. All four registries populated BEFORE any
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
 *  10. Construct NvgServiceImpl — ready for CLI/API injection
 *
 * Governing law:
 *   §32a.6  — bootstrap order (10 steps)
 *   §12.3.48 — factory registry behavior law (4 invariants)
 *   §32a.4  — RIA legacy bridge conditions
 *   §14.6.6 — fail closed on empty/all-disabled manifests
 */

import type {
  IdentityProviderFactory,
  ConnectorFactory,
  ApprovalChannelFactory,
  NvgTransportContext,
  ModelEndpoint,
  NonEmpty,
} from '@nexus/contracts';

// ── Core: crypto ─────────────────────────────────────────────────────────────
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';

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
  TierRegistry,
  NvgServiceImpl,
  JsonlRoutingTrailBackend,
} from '@nexus/vanguard';

// ── Manifest paths (§32a.6 — all four domains) ──────────────────────────────
const MANIFEST_IDENTITY = 'config/identity/providers.v1.yaml';
const MANIFEST_CONNECTORS = 'config/connectors/connectors.v1.yaml';
const MANIFEST_CHANNELS = 'config/channels/channels.v1.yaml';
const MANIFEST_ENDPOINTS = 'config/nvg/endpoints.v1.yaml';

// ── Bootstrap result ─────────────────────────────────────────────────────────
export interface BootstrapResult {
  readonly nvgService: NvgServiceImpl;
  readonly transportContext: NvgTransportContext;
  readonly tierRegistry: TierRegistry;
  readonly trailBackend: JsonlRoutingTrailBackend;
  readonly endpoints: readonly ModelEndpoint[];
  readonly controlPlanePublicKey: string;
}

/**
 * Execute the 10-step bootstrap sequence — §32a.6.
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

  // ─── Step 10: Construct NvgServiceImpl ────────────────────────────────────
  console.log('[bootstrap] Step 10: constructing NvgServiceImpl');
  const nvgService = new NvgServiceImpl();
  const trailBackend = new JsonlRoutingTrailBackend(trailDir);
  console.log('[bootstrap] Step 10 complete: NvgServiceImpl ready');

  console.log('\n[bootstrap] ══ All 10 steps complete — Nexus is ready ══\n');

  return {
    nvgService,
    transportContext,
    tierRegistry,
    trailBackend,
    endpoints,
    controlPlanePublicKey: pubKey,
  };
}
