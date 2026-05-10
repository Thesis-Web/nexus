/**
 * PostgresConnector — Live Integration Test
 *
 * Runs the connector against the dev docker-compose Postgres instances
 * defined in infra/docker-compose.dev.yaml. Skipped unless explicitly
 * opted into via NEXUS_INTEGRATION_PG=1, so day-to-day `pnpm test` and
 * `pnpm test:integration` runs without docker stay green.
 *
 * What this proves that the unit tests can't:
 *  - The pg driver actually talks to Postgres
 *  - Connection pool + timeouts wire correctly
 *  - Real query results survive the row → JSON → file → re-read round trip
 *  - Capability enforcement holds against an actually-executable INSERT
 *  - The allow-list rejects pg_catalog access against a real catalog
 *  - A governed write (warehouse update:record:internal) actually mutates
 *    the database and is then rolled back so the test is idempotent
 *
 * Operator setup:
 *   docker compose -f infra/docker-compose.dev.yaml up -d
 *   NEXUS_INTEGRATION_PG=1 pnpm test:integration
 *
 * Defaults to the docker-compose values (127.0.0.1:5433 / :5434, user
 * nexus_dev, password nexus_dev_local_only). Override per-instance via
 * NEXUS_INTEGRATION_PG_SF_HOST/PORT/USER/PASSWORD/DB and
 * NEXUS_INTEGRATION_PG_WH_HOST/PORT/USER/PASSWORD/DB if you're pointing at
 * a non-default deployment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPostgresConnector, type PostgresConnector } from './postgres.connector.js';
import type {
  AgentAction,
  ExecutionGrant,
  GrantVault,
  Uuid,
  NonEmpty,
  IsoTimestamp,
} from '@nexus/contracts';

const skipReason = process.env['NEXUS_INTEGRATION_PG'] !== '1';

const SF = {
  host: process.env['NEXUS_INTEGRATION_PG_SF_HOST'] ?? '127.0.0.1',
  port: Number(process.env['NEXUS_INTEGRATION_PG_SF_PORT'] ?? '5433'),
  user: process.env['NEXUS_INTEGRATION_PG_SF_USER'] ?? 'nexus_dev',
  password: process.env['NEXUS_INTEGRATION_PG_SF_PASSWORD'] ?? 'nexus_dev_local_only',
  database: process.env['NEXUS_INTEGRATION_PG_SF_DB'] ?? 'nexus_sales_finance',
};
const WH = {
  host: process.env['NEXUS_INTEGRATION_PG_WH_HOST'] ?? '127.0.0.1',
  port: Number(process.env['NEXUS_INTEGRATION_PG_WH_PORT'] ?? '5434'),
  user: process.env['NEXUS_INTEGRATION_PG_WH_USER'] ?? 'nexus_dev',
  password: process.env['NEXUS_INTEGRATION_PG_WH_PASSWORD'] ?? 'nexus_dev_local_only',
  database: process.env['NEXUS_INTEGRATION_PG_WH_DB'] ?? 'nexus_warehouse',
};

const SF_TABLES = [
  'customers',
  'vendors',
  'products',
  'quotes',
  'quote_lines',
  'sales_orders',
  'sales_order_lines',
  'invoices',
  'purchase_orders',
  'purchase_order_lines',
];
const WH_TABLES = ['locations', 'inventory', 'shipments', 'shipment_lines'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

function fakeVault(): GrantVault {
  const m = new Map<string, string>();
  return {
    setSecret(g, s) {
      m.set(g.grantId, s);
    },
    getSecret(g) {
      return m.get(g.grantId);
    },
    clearSecret(g) {
      m.delete(g.grantId);
    },
    assertPresent(g) {
      if (!m.has(g.grantId)) throw new Error('grant secret not present');
    },
    assertNotExpired() {},
  };
}

function makeGrant(grantId: string, capabilityId: string): ExecutionGrant {
  return {
    grantId: grantId as Uuid,
    actionId: '00000000-0000-4000-a000-000000000ccc' as Uuid,
    templateId: '00000000-0000-4000-a000-000000000eee' as Uuid,
    approvalId: null,
    mintedAt: new Date().toISOString() as IsoTimestamp,
    expiresAt: new Date(Date.now() + 60_000).toISOString() as IsoTimestamp,
    capabilityId,
    scopeDescriptor: 'integration-test' as NonEmpty,
    credentialSubject: {
      subjectId: 'pg-pool-integration' as NonEmpty,
      subjectType: 'service_identity',
      system: 'integration' as NonEmpty,
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

function makeAction(opts: {
  capability: string;
  sql: string;
  params?: readonly unknown[];
  system: string;
  actionId: string;
  runId: string;
}): AgentAction {
  return {
    actionId: opts.actionId as Uuid,
    runId: opts.runId as Uuid,
    receivedAt: new Date().toISOString() as IsoTimestamp,
    protocol: 'nexus-integration/v1.0.0' as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    actorId: '00000000-0000-4000-a000-000000000031' as Uuid,
    principalId: '00000000-0000-4000-a000-000000000030' as Uuid,
    sessionId: '00000000-0000-4000-a000-000000000111' as Uuid,
    delegationId: '00000000-0000-4000-a000-000000000222' as Uuid,
    delegationSequence: 1,
    tool: 'pg.query' as NonEmpty,
    rawVerb: 'read' as NonEmpty,
    rawTarget: opts.system as NonEmpty,
    rawPayload: { sql: opts.sql, ...(opts.params !== undefined ? { params: opts.params } : {}) },
    intent: {
      objectiveSummary: 'integration-test action' as NonEmpty,
      triggeringSource: 'integration' as NonEmpty,
      toolchainContext: 'vitest' as NonEmpty,
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: new Date().toISOString() as IsoTimestamp,
    },
    resolvedVerb: null,
    resolvedCapability: opts.capability,
    resolvedTarget: {
      system: opts.system as NonEmpty,
      resourceType: 'record' as NonEmpty,
      resourceScope: 'bulk',
      environment: 'reference' as NonEmpty,
      externalFacing: false,
    },
    resolvedDataClasses: [],
    resolvedRiskTier: 'low',
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let payloadsRoot: string;
let salesFinance: PostgresConnector | null = null;
let warehouse: PostgresConnector | null = null;
let runId: string;

beforeAll(async () => {
  if (skipReason) return;
  payloadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-pg-integ-'));
  runId = '00000000-0000-4000-a000-' + Date.now().toString().padStart(12, '0');
  salesFinance = buildPostgresConnector({
    systemType: 'sales-finance' as NonEmpty,
    host: SF.host,
    port: SF.port,
    database: SF.database,
    user: SF.user,
    password: SF.password,
    allowedTables: SF_TABLES,
    payloadsRoot,
    displayLabel: 'sales-finance-integration',
    maxRows: 100,
    connectionTimeoutMs: 3000,
  });
  warehouse = buildPostgresConnector({
    systemType: 'warehouse' as NonEmpty,
    host: WH.host,
    port: WH.port,
    database: WH.database,
    user: WH.user,
    password: WH.password,
    allowedTables: WH_TABLES,
    payloadsRoot,
    displayLabel: 'warehouse-integration',
    maxRows: 100,
    connectionTimeoutMs: 3000,
  });
});

afterAll(async () => {
  if (skipReason) return;
  if (salesFinance) await salesFinance.close();
  if (warehouse) await warehouse.close();
  if (payloadsRoot) await fs.rm(payloadsRoot, { recursive: true, force: true });
});

// Helper: dispatch one action through a connector and read its payload back.
async function dispatch(
  connector: PostgresConnector,
  capability: string,
  sql: string,
  params: readonly unknown[] = [],
  system = 'sales-finance'
): Promise<{
  status: string;
  errorType: string | null;
  redactedSummary: string;
  payload: Record<string, unknown> | null;
}> {
  const vault = fakeVault();
  const actionId = '00000000-0000-4000-a000-' + Date.now().toString(16).padStart(12, '0');
  const grant = makeGrant('grant-' + actionId, capability);
  const action = makeAction({ capability, sql, params, system, actionId, runId });
  await connector.redeemGrant(grant, vault);
  const result = await connector.execute(action, grant, vault);
  let payload: Record<string, unknown> | null = null;
  const m = /payload=(\S+)/.exec(result.redactedSummary ?? '');
  if (m && result.status === 'success') {
    const payloadFile = path.join(payloadsRoot, m[1]);
    payload = JSON.parse(await fs.readFile(payloadFile, 'utf-8')) as Record<string, unknown>;
  }
  return {
    status: result.status,
    errorType: result.errorType,
    redactedSummary: result.redactedSummary ?? '',
    payload,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(skipReason)('PostgresConnector — live integration (sales-finance)', () => {
  it('round-trips SELECT against the seeded customers table', async () => {
    const r = await dispatch(
      salesFinance!,
      'read:record:bulk',
      'SELECT customer_code, name, region FROM customers ORDER BY customer_code'
    );
    expect(r.status).toBe('success');
    expect(r.payload).not.toBeNull();
    expect(r.payload!['rowCount']).toBe(5);
    expect(r.payload!['columns'] as string[]).toEqual(['customer_code', 'name', 'region']);
    const rows = r.payload!['rows'] as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual({ customer_code: 'CUST-001', name: 'Acme Corp', region: 'west' });
  });

  it('round-trips parameterised SELECT against invoices', async () => {
    const r = await dispatch(
      salesFinance!,
      'query:data',
      'SELECT invoice_code, status, total FROM invoices WHERE status = $1 ORDER BY due_at',
      ['overdue']
    );
    expect(r.status).toBe('success');
    expect((r.payload!['rows'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('denies INSERT under read:record:bulk', async () => {
    const r = await dispatch(
      salesFinance!,
      'read:record:bulk',
      "INSERT INTO customers (customer_code, name, contact_email, region) VALUES ('CUST-INTEG', 'integ', 'x@x', 'west')"
    );
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('CAPABILITY_VIOLATION');
  });

  it('denies SELECT against pg_catalog (allow-list violation)', async () => {
    const r = await dispatch(
      salesFinance!,
      'read:record:bulk',
      'SELECT 1 FROM pg_catalog.pg_tables LIMIT 1'
    );
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('TABLE_ACCESS_DENIED');
  });

  it('denies forbidden DDL (DROP TABLE) regardless of capability', async () => {
    const r = await dispatch(salesFinance!, 'write:record:internal', 'DROP TABLE customers');
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('FORBIDDEN_QUERY');
  });
});

describe.skipIf(skipReason)('PostgresConnector — live integration (warehouse)', () => {
  it('round-trips SELECT against inventory', async () => {
    const r = await dispatch(
      warehouse!,
      'read:record:bulk',
      'SELECT sku, location_code, quantity_on_hand FROM inventory ORDER BY sku, location_code',
      [],
      'warehouse'
    );
    expect(r.status).toBe('success');
    expect((r.payload!['rows'] as unknown[]).length).toBe(10);
  });

  it('executes a governed UPDATE then rolls it back', async () => {
    // Read current count so we can restore it.
    const before = await dispatch(
      warehouse!,
      'read:record:single',
      "SELECT quantity_on_hand FROM inventory WHERE sku = 'GADGET-Y' AND location_code = 'WH-WEST'",
      [],
      'warehouse'
    );
    expect(before.status).toBe('success');
    const original = (before.payload!['rows'] as Array<Record<string, unknown>>)[0]![
      'quantity_on_hand'
    ] as number;

    // Apply the governed write.
    const update = await dispatch(
      warehouse!,
      'update:record:internal',
      "UPDATE inventory SET quantity_on_hand = quantity_on_hand - 1 WHERE sku = 'GADGET-Y' AND location_code = 'WH-WEST'",
      [],
      'warehouse'
    );
    expect(update.status).toBe('success');
    expect(update.redactedSummary).toContain('UPDATE');
    expect(update.redactedSummary).toMatch(/UPDATE → \d+ row\(s\)/);

    // Verify the row is mutated.
    const after = await dispatch(
      warehouse!,
      'read:record:single',
      "SELECT quantity_on_hand FROM inventory WHERE sku = 'GADGET-Y' AND location_code = 'WH-WEST'",
      [],
      'warehouse'
    );
    const mutated = (after.payload!['rows'] as Array<Record<string, unknown>>)[0]![
      'quantity_on_hand'
    ] as number;
    expect(mutated).toBe(original - 1);

    // Roll back so the test is idempotent on re-run.
    const rollback = await dispatch(
      warehouse!,
      'update:record:internal',
      "UPDATE inventory SET quantity_on_hand = quantity_on_hand + 1 WHERE sku = 'GADGET-Y' AND location_code = 'WH-WEST'",
      [],
      'warehouse'
    );
    expect(rollback.status).toBe('success');
  });

  it('denies SELECT under update:record:internal', async () => {
    const r = await dispatch(
      warehouse!,
      'update:record:internal',
      'SELECT sku FROM inventory LIMIT 1',
      [],
      'warehouse'
    );
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('CAPABILITY_VIOLATION');
  });
});
