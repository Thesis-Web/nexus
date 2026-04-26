/**
 * Cross-Domain Identifier Collision Tests — spec §38.11, §32a.3
 *
 * Verifies the qualified-identifier convention and collision-detection utility.
 * Within-domain uniqueness is mandatory (loaders enforce). Cross-domain reuse
 * is permitted with a non-blocking warning.
 *
 * Also verifies that the real config manifests have no collisions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import { loadIdentityManifest } from '../../packages/core/src/manifest/identity/identity-manifest-loader.js';
import { loadConnectorManifest } from '../../packages/core/src/manifest/connectors/connector-manifest-loader.js';
import { loadChannelManifest } from '../../packages/core/src/manifest/channels/channel-manifest-loader.js';
import { loadEndpointManifest } from '../../packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.js';
import { IdentityProviderFactoryRegistry } from '../../packages/core/src/manifest/identity/identity-provider-factory-registry.js';
import { ConnectorFactoryRegistry } from '../../packages/core/src/manifest/connectors/connector-factory-registry.js';
import { ApprovalChannelFactoryRegistry } from '../../packages/core/src/manifest/channels/channel-factory-registry.js';
import { ModelTransportAdapterRegistry } from '../../packages/vanguard/src/transport/registry.js';
import {
  formatQualifiedId,
  parseQualifiedId,
  detectCrossDomainCollisions,
} from '../../packages/runtime-utils/src/qualified-identifier.js';
import type {
  IdentityProviderFactory,
  ConnectorFactory,
  ApprovalChannelFactory,
  ModelTransportAdapter,
  SecretSource,
  NonEmpty,
  ModelEndpoint,
  ModelEndpointResponse,
  NvgOutboundRequest,
} from '@nexus/contracts';
import type { ManifestDomain } from '../../packages/runtime-utils/src/qualified-identifier.js';

let publicKey: string;

// ─── Stub factories ───

function stubIdentityFactory(type: string): IdentityProviderFactory {
  return {
    providerType: type as NonEmpty,
    create: async () => ({
      providerType: 'reference_adapter' as const,
      providerVersion: '1.0.0' as NonEmpty,
      resolveIdentity: async () => null,
      authenticate: async () => 'stub' as NonEmpty,
    }),
  };
}

function stubConnectorFactory(type: string): ConnectorFactory {
  return {
    connectorType: type as NonEmpty,
    create: async () => ({
      connectorId: 'stub' as NonEmpty,
      connectorType: type as NonEmpty,
      execute: async () => ({ success: true, result: {} }),
    }),
  };
}

function stubChannelFactory(type: string): ApprovalChannelFactory {
  return {
    channelType: type as NonEmpty,
    create: async () => ({
      channelType: type as NonEmpty,
      requestApproval: async () => ({
        approved: true,
        approverRef: 'stub' as NonEmpty,
      }),
    }),
  };
}

function stubAdapter(adapterId: string): ModelTransportAdapter {
  return {
    adapterId: adapterId as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: {
      safeParse: (input: unknown) => ({
        success: true as const,
        data: (input ?? {}) as Record<string, unknown>,
      }),
    },
    invoke: async (
      _ep: ModelEndpoint,
      _req: NvgOutboundRequest,
      _ss: SecretSource
    ): Promise<ModelEndpointResponse> => ({
      success: true,
      responseSize: 0,
      latencyMs: 0,
    }),
  };
}

function permissiveSecretSource(): SecretSource {
  return {
    canResolve: async () => true,
    resolve: async () => 'stub-secret',
  };
}

beforeAll(async () => {
  const key = await loadControlPlaneKey();
  publicKey = key.publicKey;
});

describe('Cross-Domain Identifier Collision Detection (§32a.3)', () => {
  // ── Qualified identifier helpers ──

  it('formatQualifiedId produces domain:primaryId', () => {
    expect(formatQualifiedId('identity', 'ria')).toBe('identity:ria');
    expect(formatQualifiedId('endpoint', 'local-ollama')).toBe('endpoint:local-ollama');
    expect(formatQualifiedId('connector', 'stub')).toBe('connector:stub');
    expect(formatQualifiedId('channel', 'cli')).toBe('channel:cli');
  });

  it('parseQualifiedId round-trips correctly', () => {
    const parsed = parseQualifiedId('identity:ria');
    expect(parsed).toEqual({ domain: 'identity', primaryId: 'ria' });
  });

  it('parseQualifiedId returns null for invalid format', () => {
    expect(parseQualifiedId('')).toBeNull();
    expect(parseQualifiedId('no-colon')).toBeNull();
    expect(parseQualifiedId(':empty-domain')).toBeNull();
    expect(parseQualifiedId('badDomain:id')).toBeNull();
  });

  // ── Collision detection utility ──

  it('detectCrossDomainCollisions returns empty when no collisions', () => {
    const registries = new Map<ManifestDomain, ReadonlySet<string>>([
      ['identity', new Set(['ria'])],
      ['connector', new Set(['stub', 'vault'])],
      ['channel', new Set(['cli'])],
      ['endpoint', new Set(['local-ollama'])],
    ]);
    expect(detectCrossDomainCollisions(registries)).toEqual([]);
  });

  it('detectCrossDomainCollisions detects collision when same primaryId in two domains', () => {
    const registries = new Map<ManifestDomain, ReadonlySet<string>>([
      ['identity', new Set(['shared-id'])],
      ['connector', new Set(['shared-id'])],
      ['channel', new Set(['cli'])],
      ['endpoint', new Set(['ep-1'])],
    ]);
    const warnings = detectCrossDomainCollisions(registries);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('shared-id');
    expect(warnings[0]).toContain('identity');
    expect(warnings[0]).toContain('connector');
  });

  it('detectCrossDomainCollisions reports all colliding domains', () => {
    const registries = new Map<ManifestDomain, ReadonlySet<string>>([
      ['identity', new Set(['triple'])],
      ['connector', new Set(['triple'])],
      ['channel', new Set(['triple'])],
      ['endpoint', new Set(['unique'])],
    ]);
    const warnings = detectCrossDomainCollisions(registries);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('identity');
    expect(warnings[0]).toContain('connector');
    expect(warnings[0]).toContain('channel');
  });

  // ── Real config manifests: no collisions ──

  it('real config manifests have no cross-domain ID collisions', async () => {
    // Load all four domains from real config files
    const idReg = new IdentityProviderFactoryRegistry();
    idReg.register(stubIdentityFactory('reference_adapter'));
    const idRecords = await loadIdentityManifest({
      manifestPath: 'config/identity/providers.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: idReg,
    });

    const connReg = new ConnectorFactoryRegistry();
    connReg.register(stubConnectorFactory('stub'));
    connReg.register(stubConnectorFactory('vault'));
    const connRecords = await loadConnectorManifest({
      manifestPath: 'config/connectors/connectors.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: connReg,
    });

    const chanReg = new ApprovalChannelFactoryRegistry();
    chanReg.register(stubChannelFactory('cli'));
    const chanRecords = await loadChannelManifest({
      manifestPath: 'config/channels/channels.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: chanReg,
    });

    const adapterReg = new ModelTransportAdapterRegistry();
    adapterReg.register(stubAdapter('ollama-chat-v1'));
    adapterReg.register(stubAdapter('anthropic-messages-v1'));
    adapterReg.register(stubAdapter('openai-chat-v1'));
    const epRecords = await loadEndpointManifest({
      manifestPath: 'config/nvg/endpoints.v1.yaml',
      controlPlanePublicKey: publicKey,
      adapterRegistry: adapterReg,
      secretSource: permissiveSecretSource(),
    });

    const domainMap = new Map<ManifestDomain, ReadonlySet<string>>([
      ['identity', new Set(idRecords.map(r => r.providerId))],
      ['connector', new Set(connRecords.map(r => r.connectorId))],
      ['channel', new Set(chanRecords.map(r => r.channelId))],
      ['endpoint', new Set(epRecords.map(r => r.endpointId))],
    ]);

    const warnings = detectCrossDomainCollisions(domainMap);
    expect(warnings).toEqual([]);
  });
});
