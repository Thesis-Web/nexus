/**
 * Factory Type Definitions Tests — spec §38.11 (audit B2)
 *
 * Verifies that the three factory interfaces (§12.3.49–.51) are
 * line-buildable and that the registry implementations round-trip.
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
  IsoTimestamp,
  Uuid,
} from '@nexus/contracts';

describe('Factory Type Definitions (audit B2)', () => {
  it('IdentityProviderFactory satisfied by minimal stub — typecheck passes', () => {
    const factory: IdentityProviderFactory = {
      providerType: 'stub' as NonEmpty,
      create: async () => ({
        providerType: 'reference_adapter' as const,
        providerVersion: '1.0.0' as NonEmpty,
        resolveIdentity: async () => null,
        authenticate: async () => 'stub' as NonEmpty,
      }),
    };
    expect(factory.providerType).toBe('stub');
  });

  it('ConnectorFactory satisfied by minimal stub — typecheck passes', () => {
    const factory: ConnectorFactory = {
      connectorType: 'stub' as NonEmpty,
      create: async () => ({
        systemType: 'stub' as NonEmpty,
        connectorVersion: '1.0.0' as NonEmpty,
        supportedCapabilities: () => ['*'],
        canProduceDiff: () => false,
        execute: async () => ({
          grantId: '00000000-0000-0000-0000-000000000000' as Uuid,
          executedAt: new Date().toISOString() as IsoTimestamp,
          status: 'success' as const,
          responseCode: null,
          durationMs: 0,
          redactedSummary: null,
          errorType: null,
          errorMessage: null,
        }),
        redeemGrant: async () => {},
      }),
    };
    expect(factory.connectorType).toBe('stub');
  });

  it('ApprovalChannelFactory satisfied by minimal stub — typecheck passes', () => {
    const factory: ApprovalChannelFactory = {
      channelType: 'cli' as NonEmpty,
      create: async () => ({
        channelId: 'cli' as NonEmpty,
        channelVersion: '1.0.0' as NonEmpty,
        dispatch: async () => {},
        awaitDecision: async () => null,
      }),
    };
    expect(factory.channelType).toBe('cli');
  });

  it('IdentityProviderFactoryRegistry.register round-trips via get/list', () => {
    const registry = new IdentityProviderFactoryRegistry();
    const factory: IdentityProviderFactory = {
      providerType: 'test-provider' as NonEmpty,
      create: async () => ({
        providerType: 'reference_adapter' as const,
        providerVersion: '1.0.0' as NonEmpty,
        resolveIdentity: async () => null,
        authenticate: async () => 'stub' as NonEmpty,
      }),
    };
    registry.register(factory);
    expect(registry.get('test-provider')).toBe(factory);
    expect(registry.list()).toContain(factory);
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('IdentityProviderFactoryRegistry duplicate throws (§12.3.48 invariant 1)', () => {
    const registry = new IdentityProviderFactoryRegistry();
    const factory: IdentityProviderFactory = {
      providerType: 'dup-test' as NonEmpty,
      create: async () => ({
        providerType: 'reference_adapter' as const,
        providerVersion: '1.0.0' as NonEmpty,
        resolveIdentity: async () => null,
        authenticate: async () => 'stub' as NonEmpty,
      }),
    };
    registry.register(factory);
    expect(() => registry.register(factory)).toThrow("duplicate providerType: 'dup-test'");
  });

  it('ConnectorFactoryRegistry.register round-trips via get/list', () => {
    const registry = new ConnectorFactoryRegistry();
    const factory: ConnectorFactory = {
      connectorType: 'test-conn' as NonEmpty,
      create: async () => ({
        systemType: 'test-conn' as NonEmpty,
        connectorVersion: '1.0.0' as NonEmpty,
        supportedCapabilities: () => ['*'],
        canProduceDiff: () => false,
        execute: async () => ({
          grantId: '00000000-0000-0000-0000-000000000000' as Uuid,
          executedAt: new Date().toISOString() as IsoTimestamp,
          status: 'success' as const,
          responseCode: null,
          durationMs: 0,
          redactedSummary: null,
          errorType: null,
          errorMessage: null,
        }),
        redeemGrant: async () => {},
      }),
    };
    registry.register(factory);
    expect(registry.get('test-conn')).toBe(factory);
    expect(registry.list()).toContain(factory);
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('ConnectorFactoryRegistry duplicate throws (§12.3.48 invariant 1)', () => {
    const registry = new ConnectorFactoryRegistry();
    const factory: ConnectorFactory = {
      connectorType: 'dup-test' as NonEmpty,
      create: async () => ({
        systemType: 'dup-test' as NonEmpty,
        connectorVersion: '1.0.0' as NonEmpty,
        supportedCapabilities: () => [],
        canProduceDiff: () => false,
        execute: async () => ({
          grantId: '00000000-0000-0000-0000-000000000000' as Uuid,
          executedAt: new Date().toISOString() as IsoTimestamp,
          status: 'success' as const,
          responseCode: null,
          durationMs: 0,
          redactedSummary: null,
          errorType: null,
          errorMessage: null,
        }),
        redeemGrant: async () => {},
      }),
    };
    registry.register(factory);
    expect(() => registry.register(factory)).toThrow("duplicate connectorType: 'dup-test'");
  });

  it('ApprovalChannelFactoryRegistry.register round-trips via get/list', () => {
    const registry = new ApprovalChannelFactoryRegistry();
    const factory: ApprovalChannelFactory = {
      channelType: 'test-chan' as NonEmpty,
      create: async () => ({
        channelId: 'test-chan' as NonEmpty,
        channelVersion: '1.0.0' as NonEmpty,
        dispatch: async () => {},
        awaitDecision: async () => null,
      }),
    };
    registry.register(factory);
    expect(registry.get('test-chan')).toBe(factory);
    expect(registry.list()).toContain(factory);
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('ApprovalChannelFactoryRegistry duplicate throws (§12.3.48 invariant 1)', () => {
    const registry = new ApprovalChannelFactoryRegistry();
    const factory: ApprovalChannelFactory = {
      channelType: 'dup-test' as NonEmpty,
      create: async () => ({
        channelId: 'dup-test' as NonEmpty,
        channelVersion: '1.0.0' as NonEmpty,
        dispatch: async () => {},
        awaitDecision: async () => null,
      }),
    };
    registry.register(factory);
    expect(() => registry.register(factory)).toThrow("duplicate channelType: 'dup-test'");
  });
});
