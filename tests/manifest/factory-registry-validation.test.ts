/**
 * Factory Registry Validation Tests — spec §38.11, §12.3.48
 *
 * Edge cases for IdentityProviderFactoryRegistry, ConnectorFactoryRegistry,
 * and ApprovalChannelFactoryRegistry. Tests the shared behavior law (§12.3.48):
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown type returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3, structural)
 *   - NOT hot-reloadable (invariant 4, structural)
 *
 * Parallel to transport/registry.test.ts which covers ModelTransportAdapterRegistry.
 */
import { describe, it, expect } from 'vitest';
import { IdentityProviderFactoryRegistry } from '../../packages/core/src/manifest/identity/identity-provider-factory-registry.js';
import { ConnectorFactoryRegistry } from '../../packages/core/src/manifest/connectors/connector-factory-registry.js';
import { ApprovalChannelFactoryRegistry } from '../../packages/core/src/manifest/channels/channel-factory-registry.js';
import type {
  IdentityProviderFactory,
  ConnectorFactory,
  ApprovalChannelFactory,
  NonEmpty,
} from '@nexus/contracts';

// ─── Stub factories ───

function stubIdentityFactory(providerType: string): IdentityProviderFactory {
  return {
    providerType: providerType as NonEmpty,
    create: async () => ({
      providerType: 'reference_adapter' as const,
      providerVersion: '1.0.0' as NonEmpty,
      resolveIdentity: async () => null,
      authenticate: async () => 'stub' as NonEmpty,
    }),
  };
}

function stubConnectorFactory(connectorType: string): ConnectorFactory {
  return {
    connectorType: connectorType as NonEmpty,
    create: async () => ({
      connectorId: 'stub' as NonEmpty,
      connectorType: connectorType as NonEmpty,
      execute: async () => ({ success: true, result: {} }),
    }),
  };
}

function stubChannelFactory(channelType: string): ApprovalChannelFactory {
  return {
    channelType: channelType as NonEmpty,
    create: async () => ({
      channelType: channelType as NonEmpty,
      requestApproval: async () => ({
        approved: true,
        approverRef: 'stub' as NonEmpty,
      }),
    }),
  };
}

// ─── Identity Provider Factory Registry ───

describe('IdentityProviderFactoryRegistry — §12.3.45, §12.3.48', () => {
  it('register + get round-trip', () => {
    const reg = new IdentityProviderFactoryRegistry();
    const factory = stubIdentityFactory('reference_adapter');
    reg.register(factory);
    expect(reg.get('reference_adapter')).toBe(factory);
  });

  it('get returns null for unregistered providerType (invariant 2)', () => {
    const reg = new IdentityProviderFactoryRegistry();
    expect(reg.get('nonexistent')).toBeNull();
  });

  it('duplicate providerType throws (invariant 1)', () => {
    const reg = new IdentityProviderFactoryRegistry();
    reg.register(stubIdentityFactory('reference_adapter'));
    expect(() => reg.register(stubIdentityFactory('reference_adapter'))).toThrow(
      "duplicate providerType: 'reference_adapter'"
    );
  });

  it('list returns all registered factories', () => {
    const reg = new IdentityProviderFactoryRegistry();
    reg.register(stubIdentityFactory('type_a'));
    reg.register(stubIdentityFactory('type_b'));
    const listed = reg.list();
    expect(listed).toHaveLength(2);
    expect(listed.map(f => f.providerType)).toContain('type_a');
    expect(listed.map(f => f.providerType)).toContain('type_b');
  });

  it('list returns empty array when no factories registered', () => {
    const reg = new IdentityProviderFactoryRegistry();
    expect(reg.list()).toEqual([]);
  });
});

// ─── Connector Factory Registry ───

describe('ConnectorFactoryRegistry — §12.3.46, §12.3.48', () => {
  it('register + get round-trip', () => {
    const reg = new ConnectorFactoryRegistry();
    const factory = stubConnectorFactory('stub');
    reg.register(factory);
    expect(reg.get('stub')).toBe(factory);
  });

  it('get returns null for unregistered connectorType (invariant 2)', () => {
    const reg = new ConnectorFactoryRegistry();
    expect(reg.get('nonexistent')).toBeNull();
  });

  it('duplicate connectorType throws (invariant 1)', () => {
    const reg = new ConnectorFactoryRegistry();
    reg.register(stubConnectorFactory('stub'));
    expect(() => reg.register(stubConnectorFactory('stub'))).toThrow(
      "duplicate connectorType: 'stub'"
    );
  });

  it('list returns all registered factories', () => {
    const reg = new ConnectorFactoryRegistry();
    reg.register(stubConnectorFactory('type_a'));
    reg.register(stubConnectorFactory('type_b'));
    const listed = reg.list();
    expect(listed).toHaveLength(2);
    expect(listed.map(f => f.connectorType)).toContain('type_a');
    expect(listed.map(f => f.connectorType)).toContain('type_b');
  });

  it('list returns empty array when no factories registered', () => {
    const reg = new ConnectorFactoryRegistry();
    expect(reg.list()).toEqual([]);
  });
});

// ─── Approval Channel Factory Registry ───

describe('ApprovalChannelFactoryRegistry — §12.3.47, §12.3.48', () => {
  it('register + get round-trip', () => {
    const reg = new ApprovalChannelFactoryRegistry();
    const factory = stubChannelFactory('cli');
    reg.register(factory);
    expect(reg.get('cli')).toBe(factory);
  });

  it('get returns null for unregistered channelType (invariant 2)', () => {
    const reg = new ApprovalChannelFactoryRegistry();
    expect(reg.get('nonexistent')).toBeNull();
  });

  it('duplicate channelType throws (invariant 1)', () => {
    const reg = new ApprovalChannelFactoryRegistry();
    reg.register(stubChannelFactory('cli'));
    expect(() => reg.register(stubChannelFactory('cli'))).toThrow("duplicate channelType: 'cli'");
  });

  it('list returns all registered factories', () => {
    const reg = new ApprovalChannelFactoryRegistry();
    reg.register(stubChannelFactory('type_a'));
    reg.register(stubChannelFactory('type_b'));
    const listed = reg.list();
    expect(listed).toHaveLength(2);
    expect(listed.map(f => f.channelType)).toContain('type_a');
    expect(listed.map(f => f.channelType)).toContain('type_b');
  });

  it('list returns empty array when no factories registered', () => {
    const reg = new ApprovalChannelFactoryRegistry();
    expect(reg.list()).toEqual([]);
  });
});
