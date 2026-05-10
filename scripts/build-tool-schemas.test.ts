/**
 * Tests for the agent-capability-filtered tool-descriptor builder.
 *
 * Asserts:
 *  - filters to descriptors whose `capability` is in the agent's
 *    `allowedCapabilities`
 *  - walks every reachable system in `agent.allowedSystems`
 *  - skips connectors not registered + the wildcard sentinel
 *  - dedupes by tool name (first-write-wins)
 *  - returns sorted output for replay-deterministic audit digests
 */
import { describe, it, expect } from 'vitest';
import type {
  Actor,
  AgentAction,
  Connector,
  ExecutionGrant,
  ExecutionGrantTemplate,
  ExecutionResult,
  GrantVault,
  IsoTimestamp,
  NonEmpty,
  ToolSchemaDescriptor,
  Uuid,
} from '@nexus/contracts';
import { buildToolDescriptorsForAgent, type ConnectorLookup } from './build-tool-schemas.js';

function descriptor(name: string, capability: string, system: string): ToolSchemaDescriptor {
  return {
    name: name as NonEmpty,
    description: `${name} tool` as NonEmpty,
    capability: capability as NonEmpty,
    target: {
      system: system as NonEmpty,
      resourceType: 'record' as NonEmpty,
      resourceScope: 'bulk' as NonEmpty,
    },
    inputSchema: { type: 'object', properties: {}, required: [] },
  };
}

function fakeConnector(
  systemType: string,
  descriptors: readonly ToolSchemaDescriptor[]
): Connector {
  return {
    systemType: systemType as NonEmpty,
    connectorVersion: 'fake-v1' as NonEmpty,
    supportedCapabilities: () => descriptors.map(d => d.capability),
    canProduceDiff: () => false,
    describeToolSchemas: () => descriptors,
    async execute(
      _action: AgentAction,
      grant: ExecutionGrant,
      _vault: GrantVault
    ): Promise<ExecutionResult> {
      return {
        grantId: grant.grantId,
        executedAt: new Date().toISOString(),
        status: 'success',
        responseCode: '200',
        durationMs: 0,
        redactedSummary: 'ok',
        errorType: null,
        errorMessage: null,
      };
    },
    async redeemGrant(_grant: ExecutionGrant, _vault: GrantVault): Promise<void> {},
  };
}

function fakeRegistry(connectors: Record<string, Connector>): ConnectorLookup {
  return {
    get(systemType) {
      return connectors[systemType] ?? null;
    },
  };
}

function actor(opts: { allowedSystems: string[]; allowedCapabilities?: string[] }): Actor {
  return {
    actorId: 'fake-agent' as Uuid,
    actorClass: 'SUPERVISED_AGENT' as NonEmpty,
    principalId: 'fake-principal' as Uuid,
    displayName: 'fake-agent' as NonEmpty,
    environment: 'reference' as NonEmpty,
    octLevel: 'OCT-OPEN',
    riskCeiling: 'medium',
    allowedSystems: opts.allowedSystems,
    allowedCapabilities: opts.allowedCapabilities,
    enabled: true,
    registeredAt: '2026-05-10T00:00:00.000Z' as IsoTimestamp,
  };
}

describe('buildToolDescriptorsForAgent', () => {
  it('returns empty when the agent has no allowedCapabilities', () => {
    const reg = fakeRegistry({
      warehouse: fakeConnector('warehouse', [
        descriptor('read_warehouse', 'read:record:bulk', 'warehouse'),
      ]),
    });
    const out = buildToolDescriptorsForAgent(actor({ allowedSystems: ['warehouse'] }), reg);
    expect(out).toEqual([]);
  });

  it('filters out descriptors whose capability is not in allowedCapabilities', () => {
    const reg = fakeRegistry({
      warehouse: fakeConnector('warehouse', [
        descriptor('read_warehouse', 'read:record:bulk', 'warehouse'),
        descriptor('update_warehouse', 'update:record:internal', 'warehouse'),
      ]),
    });
    const out = buildToolDescriptorsForAgent(
      actor({ allowedSystems: ['warehouse'], allowedCapabilities: ['read:record:bulk'] }),
      reg
    );
    expect(out.map(d => d.name)).toEqual(['read_warehouse']);
  });

  it('walks every system in allowedSystems', () => {
    const reg = fakeRegistry({
      warehouse: fakeConnector('warehouse', [
        descriptor('read_warehouse', 'read:record:bulk', 'warehouse'),
      ]),
      'sales-finance': fakeConnector('sales-finance', [
        descriptor('read_sales-finance', 'read:record:bulk', 'sales-finance'),
      ]),
    });
    const out = buildToolDescriptorsForAgent(
      actor({
        allowedSystems: ['warehouse', 'sales-finance'],
        allowedCapabilities: ['read:record:bulk'],
      }),
      reg
    );
    expect(out.map(d => d.name).sort()).toEqual(['read_sales-finance', 'read_warehouse']);
  });

  it('skips systems with no registered connector without throwing', () => {
    const reg = fakeRegistry({}); // empty
    const out = buildToolDescriptorsForAgent(
      actor({ allowedSystems: ['warehouse'], allowedCapabilities: ['read:record:bulk'] }),
      reg
    );
    expect(out).toEqual([]);
  });

  it('skips the wildcard sentinel even if present (defensive)', () => {
    const reg = fakeRegistry({
      warehouse: fakeConnector('warehouse', [
        descriptor('read_warehouse', 'read:record:bulk', 'warehouse'),
      ]),
    });
    const out = buildToolDescriptorsForAgent(
      actor({
        allowedSystems: ['*', 'warehouse'],
        allowedCapabilities: ['read:record:bulk'],
      }),
      reg
    );
    expect(out.map(d => d.name)).toEqual(['read_warehouse']);
  });

  it('dedupes by tool name when two connectors expose the same name', () => {
    const reg = fakeRegistry({
      a: fakeConnector('a', [descriptor('read_a', 'read:record:bulk', 'a')]),
      b: fakeConnector('b', [descriptor('read_a', 'read:record:bulk', 'b')]), // same name from another system
    });
    const out = buildToolDescriptorsForAgent(
      actor({ allowedSystems: ['a', 'b'], allowedCapabilities: ['read:record:bulk'] }),
      reg
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.target.system).toBe('a'); // first-write-wins
  });

  it('returns names sorted alphabetically for replay-deterministic digests', () => {
    const reg = fakeRegistry({
      warehouse: fakeConnector('warehouse', [
        descriptor('update_warehouse', 'update:record:internal', 'warehouse'),
        descriptor('read_warehouse', 'read:record:bulk', 'warehouse'),
      ]),
    });
    const out = buildToolDescriptorsForAgent(
      actor({
        allowedSystems: ['warehouse'],
        allowedCapabilities: ['read:record:bulk', 'update:record:internal'],
      }),
      reg
    );
    expect(out.map(d => d.name)).toEqual(['read_warehouse', 'update_warehouse']);
  });
});
