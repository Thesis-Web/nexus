/**
 * Reference Identity Adapter Tests — spec §32, §10.2
 * Covers: resolveIdentity (5 claims), authenticate, error paths
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ReferenceIdentityAdapter } from './reference-identity-adapter.js';
import { InMemoryActorStore } from './actor-store.js';
import { InMemoryPrincipalStore } from './principal-store.js';
import { ApiKeyAuthProvider } from './auth/api-key-auth.js';
import type { Principal, NonEmpty, Uuid } from '@nexus/contracts';

describe('Reference Identity Adapter — spec §32', () => {
  let adapter: ReferenceIdentityAdapter;
  let actorStore: InMemoryActorStore;
  let principalStore: InMemoryPrincipalStore;
  let authProvider: ApiKeyAuthProvider;

  const principal: Principal = {
    principalId: 'p-001' as Uuid,
    displayName: 'Alice' as NonEmpty,
    email: 'alice@test.local' as NonEmpty,
    registeredAt: new Date().toISOString(),
    maxDelegableRiskTier: 'high',
    allowedSystems: ['stub'],
  };

  beforeEach(async () => {
    actorStore = new InMemoryActorStore();
    principalStore = new InMemoryPrincipalStore();
    authProvider = new ApiKeyAuthProvider();

    await principalStore.register(principal);
    await actorStore.register({
      actorId: 'a-001' as Uuid,
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'p-001' as Uuid,
      environment: 'dev',
      riskCeiling: 'high',
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single'],
      roles: ['analyst'],
    });
    authProvider.registerKey('test-key-001', 'a-001');

    adapter = new ReferenceIdentityAdapter(actorStore, principalStore, authProvider);
  });

  // §10.2: providerType and providerVersion
  it('has correct provider metadata', () => {
    expect(adapter.providerType).toBe('reference_adapter');
    expect(adapter.providerVersion).toBe('v1.0.0');
  });

  // §10.3: Five required claims
  it('resolveIdentity returns all five required claims', async () => {
    const claims = await adapter.resolveIdentity('a-001' as NonEmpty);
    expect(claims).not.toBeNull();
    // 1. Principal identity
    expect(claims!.principalIdentity).toBe('p-001');
    // 2. Role assignments
    expect(claims!.roleAssignments).toEqual(['analyst']);
    // 3. Capability ceilings
    expect(claims!.capabilityCeilings).toHaveLength(1);
    expect(claims!.capabilityCeilings[0]!.allowedSystems).toEqual(['stub']);
    expect(claims!.capabilityCeilings[0]!.allowedCapabilities).toEqual(['read:record:single']);
    expect(claims!.capabilityCeilings[0]!.maxRiskTier).toBe('high');
    // 4. Environment context
    expect(claims!.environmentContext).toBe('dev');
    // 5. Actor class
    expect(claims!.actorClass).toBe('SUPERVISED_AGENT');
  });

  it('resolveIdentity returns null for unknown actor', async () => {
    const claims = await adapter.resolveIdentity('unknown' as NonEmpty);
    expect(claims).toBeNull();
  });

  it('resolveIdentity returns null when principal missing', async () => {
    await actorStore.register({
      actorId: 'orphan' as Uuid,
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'missing-principal' as Uuid,
      environment: 'dev',
      riskCeiling: 'low',
      allowedSystems: [],
    });
    const claims = await adapter.resolveIdentity('orphan' as NonEmpty);
    expect(claims).toBeNull();
  });

  // §32.2: authenticate via API key
  it('authenticate returns actor identifier for valid key', async () => {
    const actorId = await adapter.authenticate({
      type: 'api_key',
      value: 'test-key-001' as NonEmpty,
    });
    expect(actorId).toBe('a-001');
  });

  it('authenticate throws on invalid key', async () => {
    await expect(
      adapter.authenticate({
        type: 'api_key',
        value: 'bad-key' as NonEmpty,
      })
    ).rejects.toThrow('INVALID_API_KEY');
  });

  it('authenticate throws on unsupported auth type', async () => {
    await expect(
      adapter.authenticate({
        type: 'jwt',
        value: 'some-token' as NonEmpty,
      })
    ).rejects.toThrow('UNSUPPORTED_AUTH_TYPE');
  });

  // Edge: actor with no roles or capabilities
  it('resolveIdentity handles missing optional fields', async () => {
    await actorStore.register({
      actorId: 'minimal' as Uuid,
      actorClass: 'SERVICE_AUTOMATION',
      principalId: 'p-001' as Uuid,
      environment: 'production',
      riskCeiling: 'low',
      allowedSystems: [],
    });
    const claims = await adapter.resolveIdentity('minimal' as NonEmpty);
    expect(claims).not.toBeNull();
    expect(claims!.roleAssignments).toEqual([]);
    expect(claims!.capabilityCeilings[0]!.allowedCapabilities).toEqual([]);
  });
});
