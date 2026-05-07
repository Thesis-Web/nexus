/**
 * ReferenceCatalogReader — tests
 * SPEC-addendum-beta1-admin-dashboard-v0-1 (Claude C).
 *
 * Covers TURN10-CATALOG-001/002:
 *   1. Backward compat — zero-arg constructor returns empty arrays.
 *   2. listAgents — SUPERVISED_AGENT only + claims-ceiling intersect + disabled
 *      flagged not-selectable but visible.
 *   3. listModels — visible to admin, selectable iff healthy.
 *   4. listConnectors — allowedSystems intersect ceiling; wildcard '*' passes.
 *
 * The reader has no other dependencies; tests directly construct it with
 * fake actor registry + manifest record arrays.
 */

import { describe, it, expect } from 'vitest';
import { ReferenceCatalogReader } from '../../packages/workspace-ref/src/stores/catalog-reader.js';
import type {
  ActorRegistry,
  Actor,
  IdentityClaims,
  ConnectorManifestRecord,
  ModelEndpoint,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeActor(overrides: Partial<Actor>): Actor {
  return {
    actorId: '00000000-0000-0000-0000-000000000001' as Uuid,
    actorClass: 'SUPERVISED_AGENT',
    principalId: '00000000-0000-0000-0000-0000000000aa' as Uuid,
    displayName: 'agent' as NonEmpty,
    environment: 'reference',
    octLevel: 'OCT-OPEN',
    riskCeiling: 'medium',
    allowedSystems: ['stub'],
    allowedCapabilities: ['read:record:single'],
    enabled: true,
    registeredAt: new Date().toISOString() as NonEmpty,
    purpose: 'test agent' as NonEmpty,
    ...overrides,
  } as Actor;
}

function fakeActorRegistry(actors: Actor[]): ActorRegistry {
  return {
    list: async () => actors,
    get: async (id: Uuid) => actors.find(a => a.actorId === id) ?? null,
    register: async () => {},
    updateOct: async () => {},
    getByClass: async (cls: string) => actors.filter(a => a.actorClass === cls),
  } as unknown as ActorRegistry;
}

function makeClaims(allowedSystems: string[]): IdentityClaims {
  return {
    principalIdentity: 'test:principal' as NonEmpty,
    roleAssignments: ['user'] as NonEmpty[],
    capabilityCeilings: [
      {
        allowedSystems,
        allowedCapabilities: ['*'],
        maxRiskTier: 'critical',
      },
    ],
    environmentContext: 'reference',
    actorClass: 'HUMAN',
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ReferenceCatalogReader — backward compat (empty deps)', () => {
  const claims = makeClaims(['*']);

  it('zero-arg constructor returns empty agents', async () => {
    const r = new ReferenceCatalogReader();
    expect(await r.listAgents(claims)).toEqual([]);
  });

  it('zero-arg constructor returns empty models', async () => {
    const r = new ReferenceCatalogReader();
    expect(await r.listModels(claims)).toEqual([]);
  });

  it('zero-arg constructor returns empty connectors', async () => {
    const r = new ReferenceCatalogReader();
    expect(await r.listConnectors(claims)).toEqual([]);
  });

  it('empty deps object also returns empty arrays', async () => {
    const r = new ReferenceCatalogReader({});
    expect(await r.listAgents(claims)).toEqual([]);
    expect(await r.listModels(claims)).toEqual([]);
    expect(await r.listConnectors(claims)).toEqual([]);
  });
});

describe('ReferenceCatalogReader.listAgents', () => {
  const supervisedAgent = makeActor({
    actorId: 'aaa00001-0000-0000-0000-000000000001' as Uuid,
    actorClass: 'SUPERVISED_AGENT',
    displayName: 'supervised' as NonEmpty,
  });
  const orchestrator = makeActor({
    actorId: 'aaa00002-0000-0000-0000-000000000002' as Uuid,
    actorClass: 'AUTONOMOUS_AGENT',
    displayName: 'orchestrator' as NonEmpty,
  });
  const disabledAgent = makeActor({
    actorId: 'aaa00003-0000-0000-0000-000000000003' as Uuid,
    actorClass: 'SUPERVISED_AGENT',
    displayName: 'disabled-agent' as NonEmpty,
    enabled: false,
  });
  const stranger = makeActor({
    actorId: 'aaa00004-0000-0000-0000-000000000004' as Uuid,
    actorClass: 'SUPERVISED_AGENT',
    displayName: 'stranger' as NonEmpty,
    allowedSystems: ['salesforce'],
  });

  it('returns only SUPERVISED_AGENT actors', async () => {
    const r = new ReferenceCatalogReader({
      actorRegistry: fakeActorRegistry([supervisedAgent, orchestrator]),
    });
    const items = await r.listAgents(makeClaims(['*']));
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(supervisedAgent.actorId);
  });

  it('marks disabled SUPERVISED_AGENTs as visible but not selectable', async () => {
    const r = new ReferenceCatalogReader({
      actorRegistry: fakeActorRegistry([supervisedAgent, disabledAgent]),
    });
    const items = await r.listAgents(makeClaims(['*']));
    const disabled = items.find(i => i.id === disabledAgent.actorId);
    expect(disabled?.visible).toBe(true);
    expect(disabled?.selectable).toBe(false);
    expect(disabled?.reason).toMatch(/disabled/i);
  });

  it('hides agents whose allowedSystems are outside the caller ceiling', async () => {
    const r = new ReferenceCatalogReader({
      actorRegistry: fakeActorRegistry([supervisedAgent, stranger]),
    });
    const items = await r.listAgents(makeClaims(['stub']));
    expect(items.find(i => i.id === supervisedAgent.actorId)?.visible).toBe(true);
    expect(items.find(i => i.id === stranger.actorId)?.visible).toBe(false);
  });
});

describe('ReferenceCatalogReader.listConnectors', () => {
  const stub: ConnectorManifestRecord = {
    connectorId: 'stub' as NonEmpty,
    connectorType: 'stub' as NonEmpty,
    allowedSystems: ['*'],
    configuration: {},
  };
  const restricted: ConnectorManifestRecord = {
    connectorId: 'sap' as NonEmpty,
    connectorType: 'sap' as NonEmpty,
    allowedSystems: ['sap'],
    configuration: {},
  };

  it('wildcard "*" allowedSystems passes for any caller ceiling', async () => {
    const r = new ReferenceCatalogReader({ connectorRecords: [stub] });
    const items = await r.listConnectors(makeClaims(['stub']));
    expect(items[0]?.visible).toBe(true);
    expect(items[0]?.selectable).toBe(true);
  });

  it('hides connectors whose systems are outside caller ceiling', async () => {
    const r = new ReferenceCatalogReader({ connectorRecords: [restricted] });
    const items = await r.listConnectors(makeClaims(['stub']));
    expect(items[0]?.visible).toBe(false);
    expect(items[0]?.selectable).toBe(false);
    expect(items[0]?.reason).toMatch(/ceiling/i);
  });

  it('wildcard "*" caller ceiling passes everything', async () => {
    const r = new ReferenceCatalogReader({ connectorRecords: [restricted] });
    const items = await r.listConnectors(makeClaims(['*']));
    expect(items[0]?.visible).toBe(true);
  });
});

describe('ReferenceCatalogReader.listModels', () => {
  const healthyEp: ModelEndpoint = {
    endpointId: 'local-ollama' as NonEmpty,
    tier: 'on_prem_general' as NonEmpty,
    url: 'http://localhost:11434/api/chat' as NonEmpty,
    adapterId: 'ollama-chat-v1' as NonEmpty,
    modelName: 'llama3.2' as NonEmpty,
    auth: { kind: 'none' },
    timeoutMs: 30000,
    adapterConfig: {},
    healthy: true,
    lastCheckAt: new Date().toISOString() as NonEmpty,
  };
  const unhealthyEp: ModelEndpoint = {
    ...healthyEp,
    endpointId: 'down' as NonEmpty,
    healthy: false,
  };

  it('selectable iff healthy', async () => {
    const r = new ReferenceCatalogReader({ endpointRecords: [healthyEp, unhealthyEp] });
    const items = await r.listModels(makeClaims(['*']));
    const ok = items.find(i => i.id === 'local-ollama');
    const broken = items.find(i => i.id === 'down');
    expect(ok?.selectable).toBe(true);
    expect(broken?.selectable).toBe(false);
    expect(broken?.reason).toMatch(/unhealthy/i);
  });
});
