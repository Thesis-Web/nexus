/**
 * PostgresConnector — Unit Tests
 *
 * No docker, no real Postgres. The PgQueryExecutor surface is the seam:
 * tests inject a fake. Coverage:
 *   - Round-trip success (SELECT) writes a payload file and returns a
 *     redactedSummary referencing it
 *   - Read capability denies INSERT/UPDATE/DELETE
 *   - Write capability denies SELECT
 *   - Forbidden DDL (CREATE/DROP/etc) denied regardless of capability
 *   - Allow-list rejects queries against unlisted tables
 *   - pg-side errors are redacted (no credentials in errorMessage)
 *   - Empty payload shape rejected with INVALID_PAYLOAD
 *   - vault.assertPresent / assertNotExpired called before any work
 *   - Row count beyond maxRows is truncated and flagged
 *   - Factory throws fail-closed when password is empty
 *   - Plaintext value never appears in any redactedSummary or errorMessage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PostgresConnector,
  buildPostgresConnector,
  type PgQueryExecutor,
  type PgQueryResult,
  type PostgresConnectorOptions,
} from './postgres.connector.js';
import type {
  AgentAction,
  ExecutionGrant,
  GrantVault,
  Uuid,
  NonEmpty,
  IsoTimestamp,
} from '@nexus/contracts';

// ── Test doubles ─────────────────────────────────────────────────────────────

interface FakeExecutorState {
  calls: Array<{ sql: string; params: readonly unknown[] }>;
  next: PgQueryResult | (() => never);
}

function fakeExecutor(initial: PgQueryResult | (() => never)): {
  exec: PgQueryExecutor;
  state: FakeExecutorState;
} {
  const state: FakeExecutorState = { calls: [], next: initial };
  const exec: PgQueryExecutor = {
    async query(text, params) {
      state.calls.push({ sql: text, params });
      if (typeof state.next === 'function') {
        state.next();
      }
      return state.next as PgQueryResult;
    },
    async end() {},
  };
  return { exec, state };
}

interface VaultEvents {
  setSecret: number;
  assertPresent: number;
  assertNotExpired: number;
}

function fakeVault(): { vault: GrantVault; events: VaultEvents } {
  const events: VaultEvents = { setSecret: 0, assertPresent: 0, assertNotExpired: 0 };
  const secrets = new Map<string, string>();
  const vault: GrantVault = {
    setSecret(grant, secret) {
      events.setSecret++;
      secrets.set(grant.grantId, secret);
    },
    getSecret(grant) {
      return secrets.get(grant.grantId);
    },
    clearSecret(grant) {
      secrets.delete(grant.grantId);
    },
    assertPresent(grant) {
      events.assertPresent++;
      if (!secrets.has(grant.grantId)) throw new Error('grant secret not present');
    },
    assertNotExpired(_grant) {
      events.assertNotExpired++;
    },
  };
  return { vault, events };
}

const TEST_RUN = '00000000-0000-4000-a000-000000000aaa' as Uuid;
const TEST_ACTOR = '00000000-0000-4000-a000-000000000bbb' as Uuid;

function makeAction(opts: {
  capability: string;
  sql: string;
  params?: readonly unknown[];
  system?: string;
  actionId?: string;
}): AgentAction {
  return {
    actionId: (opts.actionId ?? '00000000-0000-4000-a000-000000000ccc') as Uuid,
    runId: TEST_RUN,
    receivedAt: new Date().toISOString() as IsoTimestamp,
    protocol: 'nexus-test/v1.0.0' as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    actorId: TEST_ACTOR,
    principalId: TEST_ACTOR,
    sessionId: TEST_ACTOR,
    delegationId: TEST_ACTOR,
    delegationSequence: 1,
    tool: 'tool.test' as NonEmpty,
    rawVerb: 'read' as NonEmpty,
    rawTarget: (opts.system ?? 'sales-finance') as NonEmpty,
    rawPayload: { sql: opts.sql, ...(opts.params !== undefined ? { params: opts.params } : {}) },
    intent: {
      objectiveSummary: 'unit-test action' as NonEmpty,
      triggeringSource: 'test' as NonEmpty,
      toolchainContext: 'vitest' as NonEmpty,
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: new Date().toISOString() as IsoTimestamp,
    },
    resolvedVerb: null,
    resolvedCapability: opts.capability,
    resolvedTarget: {
      system: (opts.system ?? 'sales-finance') as NonEmpty,
      resourceType: 'record' as NonEmpty,
      resourceScope: 'bulk',
      environment: 'reference' as NonEmpty,
      externalFacing: false,
    },
    resolvedDataClasses: [],
    resolvedRiskTier: 'low',
  };
}

function makeGrant(): ExecutionGrant {
  return {
    grantId: '00000000-0000-4000-a000-000000000ddd' as Uuid,
    actionId: '00000000-0000-4000-a000-000000000ccc' as Uuid,
    templateId: '00000000-0000-4000-a000-000000000eee' as Uuid,
    approvalId: null,
    mintedAt: new Date().toISOString() as IsoTimestamp,
    expiresAt: new Date(Date.now() + 60_000).toISOString() as IsoTimestamp,
    capabilityId: 'read:record:bulk',
    scopeDescriptor: 'test' as NonEmpty,
    credentialSubject: {
      subjectId: 'pg-pool-test' as NonEmpty,
      subjectType: 'service_identity',
      system: 'sales-finance' as NonEmpty,
    },
    resourceBounds: {
      allowedResourceTypes: ['record'],
      maxRecords: 1000,
      allowBulk: true,
      allowExternalFacing: false,
    },
    environmentBound: 'reference' as NonEmpty,
    signature: 'c'.repeat(86),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let payloadsRoot: string;

beforeEach(async () => {
  payloadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-pg-conn-'));
});

afterEach(async () => {
  await fs.rm(payloadsRoot, { recursive: true, force: true });
});

function buildConnector(
  exec: PgQueryExecutor,
  overrides: Partial<PostgresConnectorOptions> = {}
): PostgresConnector {
  return new PostgresConnector({
    systemType: 'sales-finance' as NonEmpty,
    executor: exec,
    allowedTables: ['customers', 'sales_orders', 'invoices', 'products'],
    payloadsRoot,
    displayLabel: 'sales-finance',
    maxRows: 50,
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PostgresConnector — happy path', () => {
  it('round-trips a SELECT and writes the payload file', async () => {
    const rows = [
      { customer_code: 'CUST-001', name: 'Acme' },
      { customer_code: 'CUST-002', name: 'Globex' },
    ];
    const { exec, state } = fakeExecutor({
      rows,
      rowCount: rows.length,
      fields: [{ name: 'customer_code' }, { name: 'name' }],
    });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({
        capability: 'read:record:bulk',
        sql: 'SELECT customer_code, name FROM customers',
      }),
      grant,
      vault
    );

    expect(result.status).toBe('success');
    expect(result.responseCode).toBe('200');
    expect(result.errorType).toBeNull();
    expect(result.redactedSummary).toContain('SELECT → 2 row(s)');
    expect(result.redactedSummary).toContain('payload=');
    expect(result.redactedSummary).toContain('00000000-0000-4000-a000-000000000ccc.json');
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.sql).toBe('SELECT customer_code, name FROM customers');

    // Payload on disk
    const payloadPath = path.join(
      payloadsRoot,
      TEST_RUN,
      '00000000-0000-4000-a000-000000000ccc.json'
    );
    const stat = await fs.stat(payloadPath);
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    const written = JSON.parse(await fs.readFile(payloadPath, 'utf-8'));
    expect(written.connector).toBe('postgres');
    expect(written.systemType).toBe('sales-finance');
    expect(written.rowCount).toBe(2);
    expect(written.columns).toEqual(['customer_code', 'name']);
    expect(written.rows).toEqual(rows);
    expect(written.truncated).toBe(false);
  });

  it('truncates row payload to maxRows and flags it', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    const { exec } = fakeExecutor({
      rows,
      rowCount: rows.length,
      fields: [{ name: 'id' }],
    });
    const connector = buildConnector(exec, { maxRows: 50 });
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({ capability: 'query:data', sql: 'SELECT id FROM products' }),
      grant,
      vault
    );
    expect(result.status).toBe('success');
    expect(result.redactedSummary).toContain('truncated to 50');
    const payloadPath = path.join(
      payloadsRoot,
      TEST_RUN,
      '00000000-0000-4000-a000-000000000ccc.json'
    );
    const written = JSON.parse(await fs.readFile(payloadPath, 'utf-8'));
    expect(written.rows).toHaveLength(50);
    expect(written.truncated).toBe(true);
    expect(written.rowCount).toBe(200);
  });
});

describe('PostgresConnector — capability enforcement', () => {
  it('denies INSERT under a read capability', async () => {
    const { exec, state } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({
        capability: 'read:record:single',
        sql: "INSERT INTO customers (customer_code, name) VALUES ('CUST-X', 'Naughty')",
      }),
      grant,
      vault
    );
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('CAPABILITY_VIOLATION');
    expect(result.errorMessage).toContain('read');
    expect(result.errorMessage).toContain('INSERT');
    expect(state.calls).toHaveLength(0);
  });

  it('denies SELECT under a write capability', async () => {
    const { exec, state } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({
        capability: 'create:record:internal',
        sql: 'SELECT * FROM customers',
      }),
      grant,
      vault
    );
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('CAPABILITY_VIOLATION');
    expect(state.calls).toHaveLength(0);
  });

  it('denies CREATE/DROP/TRUNCATE regardless of capability', async () => {
    const { exec, state } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    for (const sql of ['DROP TABLE customers', 'TRUNCATE customers', 'CREATE TABLE evil (x INT)']) {
      const result = await connector.execute(
        makeAction({ capability: 'write:record:internal', sql }),
        grant,
        vault
      );
      expect(result.status).toBe('failure');
      expect(result.errorType).toBe('FORBIDDEN_QUERY');
    }
    expect(state.calls).toHaveLength(0);
  });

  it('denies an unrecognized capability', async () => {
    const { exec, state } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({ capability: 'send:message:external', sql: 'SELECT 1' }),
      grant,
      vault
    );
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('CAPABILITY_UNRECOGNIZED');
    expect(state.calls).toHaveLength(0);
  });
});

describe('PostgresConnector — allow-list enforcement', () => {
  it('rejects a query that touches no allow-listed table', async () => {
    const { exec, state } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec, { allowedTables: ['products'] });
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({ capability: 'read:record:bulk', sql: 'SELECT * FROM pg_catalog.pg_tables' }),
      grant,
      vault
    );
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('TABLE_ACCESS_DENIED');
    expect(state.calls).toHaveLength(0);
  });

  it('accepts schema-qualified references to allow-listed tables', async () => {
    const { exec, state } = fakeExecutor({
      rows: [{ x: 1 }],
      rowCount: 1,
      fields: [{ name: 'x' }],
    });
    const connector = buildConnector(exec, { allowedTables: ['products'] });
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({
        capability: 'read:record:bulk',
        sql: 'SELECT 1 AS x FROM public.products LIMIT 1',
      }),
      grant,
      vault
    );
    expect(result.status).toBe('success');
    expect(state.calls).toHaveLength(1);
  });

  it('empty allow-list = no restriction', async () => {
    const { exec } = fakeExecutor({ rows: [], rowCount: 0, fields: [] });
    const connector = buildConnector(exec, { allowedTables: [] });
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1' }),
      grant,
      vault
    );
    expect(result.status).toBe('success');
  });
});

describe('PostgresConnector — payload validation', () => {
  it('rejects a missing sql field', async () => {
    const { exec } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const action = makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1' });
    (action as { rawPayload: unknown }).rawPayload = { params: [] };
    const result = await connector.execute(action, grant, vault);
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('INVALID_PAYLOAD');
  });

  it('rejects a non-object payload', async () => {
    const { exec } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const action = makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1' });
    (action as { rawPayload: unknown }).rawPayload = 'SELECT 1';
    const result = await connector.execute(action, grant, vault);
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('INVALID_PAYLOAD');
  });

  it('rejects non-array params', async () => {
    const { exec } = fakeExecutor({ rows: [], rowCount: 0 });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const action = makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1' });
    (action as { rawPayload: unknown }).rawPayload = { sql: 'SELECT 1', params: 'oops' };
    const result = await connector.execute(action, grant, vault);
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('INVALID_PAYLOAD');
  });
});

describe('PostgresConnector — error redaction', () => {
  it('strips credential fragments from postgres error messages', async () => {
    const SECRET = 'sk-do-not-leak-this-1f3e-9c';
    const { exec } = fakeExecutor(() => {
      throw new Error(
        `connection failed: password=${SECRET} could not authenticate to postgres://nexus_dev:${SECRET}@db:5432/nexus`
      );
    });
    const connector = buildConnector(exec);
    const { vault } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    const result = await connector.execute(
      makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1 FROM products' }),
      grant,
      vault
    );
    expect(result.status).toBe('failure');
    expect(result.errorType).toBe('POSTGRES_QUERY_ERROR');
    expect(result.errorMessage ?? '').not.toContain(SECRET);
    expect(result.redactedSummary ?? '').not.toContain(SECRET);
    expect(result.errorMessage ?? '').toContain('[REDACTED]');
  });
});

describe('PostgresConnector — vault discipline', () => {
  it('asserts presence and expiry before any work', async () => {
    const { exec } = fakeExecutor({ rows: [], rowCount: 0, fields: [] });
    const connector = buildConnector(exec);
    const { vault, events } = fakeVault();
    const grant = makeGrant();
    await connector.redeemGrant(grant, vault);
    expect(events.setSecret).toBe(1);
    await connector.execute(
      makeAction({ capability: 'read:record:bulk', sql: 'SELECT 1 FROM products' }),
      grant,
      vault
    );
    expect(events.assertPresent).toBe(1);
    expect(events.assertNotExpired).toBe(1);
  });
});

describe('buildPostgresConnector — fail-closed credential resolution', () => {
  it('throws when password is empty', () => {
    expect(() =>
      buildPostgresConnector({
        systemType: 'sales-finance' as NonEmpty,
        host: '127.0.0.1',
        port: 5433,
        database: 'nexus_sample',
        user: 'nexus_dev',
        password: '',
        allowedTables: [],
        payloadsRoot,
      })
    ).toThrow(/password is required/i);
  });
});
