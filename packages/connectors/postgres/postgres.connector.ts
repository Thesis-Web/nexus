/**
 * PostgresConnector — Nexus default-shipped target-system connector.
 *
 * Layer 4 — imports from @nexus/contracts only (+ pg driver, node:fs/path).
 * Implements the §12.3.25 Connector interface; constructed by the factory
 * registered at bootstrap step 1c. Gate 06 looks up an instance by
 * `action.resolvedTarget.system` (which matches `systemType` here) and
 * calls execute().
 *
 * The connector is reused across many runs — one process-wide instance per
 * configured target (e.g. one for the sales-finance DB, one for the
 * warehouse DB). Each holds its own pg.Pool and resolves its own credential
 * exactly once at startup via the SecretSource (vault).
 *
 * What this connector does:
 *  - Validates the inbound action shape ({ sql, params? }).
 *  - Enforces capability semantics (`read:*`/`query:*`/`search:*` cannot
 *    issue writes; `create/update/delete/write:*` cannot issue plain SELECT).
 *  - Enforces an allow-list of table names (manifest-supplied).
 *  - Executes the parameterised query against pg.Pool.
 *  - Writes the result rows to runs/payloads/<runId>/<actionId>.json so the
 *    orchestrator's tool-use round-trip can hand them back to the LLM.
 *  - Returns ExecutionResult with a redacted, audit-safe summary that
 *    includes the payload path. Never returns or logs the rows themselves.
 *  - Redacts credential fragments out of any pg error message before
 *    surfacing it as ExecutionResult.errorMessage.
 *
 * What this connector does NOT do:
 *  - Open the pool itself when a credential is missing — the factory is
 *    responsible for fail-closed credential resolution.
 *  - Touch the mailbox directly (Gate 06 owns the connector surface; the
 *    mailbox-handoff lives in the orchestrator dispatch loop).
 *  - Allow arbitrary SQL outside the allow-list table set or the
 *    capability-bound query class.
 *  - Persist data anywhere except the action-scoped payload file.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import pg from 'pg';
import {
  type Connector,
  type ConnectorFactory,
  type AgentAction,
  type ExecutionGrant,
  type ExecutionResult,
  type ExecutionGrantTemplate,
  type GrantVault,
  type NonEmpty,
  type ToolSchemaDescriptor,
  type ToolInputSchema,
} from '@nexus/contracts';

const { Pool } = pg;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal pg.Pool surface this connector uses. The factory wraps a real
 * pg.Pool; tests inject a fake. Keeping this narrow means tests don't have
 * to mock the entire pg API.
 */
export interface PgQueryExecutor {
  query(text: string, params: readonly unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
}

export interface PgQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
  readonly fields?: readonly { name: string }[];
}

/** Configuration built by the factory and passed into the connector. */
export interface PostgresConnectorOptions {
  /**
   * The system identifier this connector serves. Gate 06 uses it as the
   * lookup key in the per-call connector registry. Must match
   * `action.resolvedTarget.system` for reachable actions and must match
   * one entry in the manifest's `allowedSystems`.
   */
  readonly systemType: NonEmpty;
  /** Already-constructed pg pool (or fake during tests). */
  readonly executor: PgQueryExecutor;
  /** Allow-list of table names addressable by inbound queries. */
  readonly allowedTables: readonly string[];
  /** Absolute path to the per-action payload directory root. */
  readonly payloadsRoot: string;
  /**
   * Redacted display label for evidence summaries (e.g. "sales-finance"
   * instead of the full pg URI). Defaults to systemType.
   */
  readonly displayLabel?: string;
  /** Hard cap on rows persisted per execution. Defaults to 1000. */
  readonly maxRows?: number;
}

/** Factory-time configuration parsed from the connector manifest entry. */
export interface PostgresConnectorFactoryConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly queryTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly allowedTables: readonly string[];
  readonly systemType: NonEmpty;
  readonly displayLabel?: string;
  readonly maxRows?: number;
  readonly payloadsRoot: string;
  readonly ssl?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const READ_PREFIXES = ['SELECT', 'EXPLAIN', 'SHOW', 'WITH'];
const WRITE_PREFIXES = ['INSERT', 'UPDATE', 'DELETE'];
const FORBIDDEN_PREFIXES = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE', 'COPY'];

function firstSqlVerb(sql: string): string {
  const trimmed = sql.replace(/^\s+/, '').replace(/^--[^\n]*\n/g, '');
  const m = /^[A-Za-z]+/.exec(trimmed);
  return m ? m[0].toUpperCase() : '';
}

function isReadOnly(sql: string): boolean {
  return READ_PREFIXES.includes(firstSqlVerb(sql));
}

function isWrite(sql: string): boolean {
  return WRITE_PREFIXES.includes(firstSqlVerb(sql));
}

function isForbidden(sql: string): boolean {
  return FORBIDDEN_PREFIXES.includes(firstSqlVerb(sql));
}

/**
 * Conservative table-mention check: tokens between word boundaries are
 * matched case-insensitively against the allow-list. Schema-qualified
 * names (`public.products`) match `products`. Quoted identifiers
 * ("Products") match `products`. This is intentionally permissive — the
 * primary defence is parameterised queries + capability enforcement; the
 * allow-list is a second line of defence to keep runaway agents from
 * scanning system catalogs.
 */
function queryTouchesAllowedTable(sql: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true; // empty allow-list = no restriction
  const lower = sql.toLowerCase();
  return allowed.some(t => {
    const name = t.toLowerCase();
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(lower);
  });
}

function redactCredentialFragments(s: string): string {
  return s
    .replace(
      /(password|passwd|secret|token|key|credential|authorization|bearer)[=:\s][^\s,;'"]*/gi,
      '[REDACTED]'
    )
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[REDACTED]@');
}

interface ExtractedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function extractQuery(action: AgentAction): ExtractedQuery {
  const payload = action.rawPayload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('rawPayload must be an object of shape { sql: string, params?: unknown[] }');
  }
  const obj = payload as Record<string, unknown>;
  const sqlValue = obj['sql'];
  if (typeof sqlValue !== 'string' || sqlValue.trim().length === 0) {
    throw new Error('rawPayload.sql must be a non-empty string');
  }
  const sql = sqlValue.trim();
  const rawParams = obj['params'];
  if (rawParams !== undefined && !Array.isArray(rawParams)) {
    throw new Error('rawPayload.params, if present, must be an array');
  }
  const params: readonly unknown[] = Array.isArray(rawParams) ? rawParams : [];
  return { sql, params };
}

function failure(
  grant: ExecutionGrant,
  startMs: number,
  errorType: string,
  errorMessage: string,
  redactedSummary: string
): ExecutionResult {
  return {
    grantId: grant.grantId,
    executedAt: new Date().toISOString(),
    status: 'failure',
    responseCode: null,
    durationMs: Date.now() - startMs,
    redactedSummary: redactedSummary.slice(0, 500),
    errorType,
    errorMessage: errorMessage.slice(0, 500),
  };
}

// ── Connector ────────────────────────────────────────────────────────────────

export class PostgresConnector implements Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion = 'v0.1.0' as NonEmpty;

  private readonly executor: PgQueryExecutor;
  private readonly allowedTables: readonly string[];
  private readonly payloadsRoot: string;
  private readonly displayLabel: string;
  private readonly maxRows: number;

  constructor(opts: PostgresConnectorOptions) {
    this.systemType = opts.systemType;
    this.executor = opts.executor;
    this.allowedTables = opts.allowedTables;
    this.payloadsRoot = opts.payloadsRoot;
    this.displayLabel = opts.displayLabel ?? (opts.systemType as string);
    this.maxRows = opts.maxRows ?? 1000;
  }

  supportedCapabilities(): string[] {
    return [
      'read:record:single',
      'read:record:bulk',
      'query:data',
      'search:data',
      'execute:query',
      'create:record:internal',
      'update:record:internal',
      'delete:record',
      'write:record:internal',
    ];
  }

  describeToolSchemas(): readonly ToolSchemaDescriptor[] {
    // Two-tool surface: one for read paths, one for governed writes.
    // The connector enforces verb/SQL consistency at execute time and
    // checks the allow-list of tables — the gates enforce capability.
    // We surface the table allow-list in the description so the model
    // doesn't waste turns referencing tables it can't reach.
    const allowedTablesText =
      this.allowedTables.length > 0 ? ` Allowed tables: ${this.allowedTables.join(', ')}.` : '';
    const sqlInputSchema: ToolInputSchema = {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            'SQL statement to execute. Use $1, $2, ... placeholders for parameters; do not interpolate values into the SQL string.',
        },
        params: {
          type: 'array',
          description:
            'Parameter values for the SQL placeholders, in $1, $2, ... order. Strings, numbers, and booleans are accepted.',
        },
      },
      required: ['sql'],
    };
    return [
      {
        name: `read_${this.systemType}` as NonEmpty,
        description: (`Run a SELECT query against the ${this.displayLabel} postgres database and ` +
          `return the matching rows as JSON. Use this to look up records, search, or ` +
          `compute aggregates over existing data.${allowedTablesText}`) as NonEmpty,
        capability: 'read:record:bulk' as NonEmpty,
        target: {
          system: this.systemType,
          resourceType: 'record' as NonEmpty,
          resourceScope: 'bulk' as NonEmpty,
        },
        inputSchema: sqlInputSchema,
      },
      {
        name: `update_${this.systemType}` as NonEmpty,
        description:
          (`Run an INSERT, UPDATE, or DELETE statement against the ${this.displayLabel} ` +
            `postgres database. Always use parameterised queries; never interpolate user ` +
            `data into the SQL string. Returns a write receipt; row data is not echoed ` +
            `back.${allowedTablesText}`) as NonEmpty,
        capability: 'update:record:internal' as NonEmpty,
        target: {
          system: this.systemType,
          resourceType: 'record' as NonEmpty,
          resourceScope: 'single' as NonEmpty,
        },
        inputSchema: sqlInputSchema,
      },
    ];
  }

  canProduceDiff(): boolean {
    return true;
  }

  async produceDiff(action: AgentAction, _template: ExecutionGrantTemplate): Promise<string> {
    let sql: string;
    let params: readonly unknown[];
    try {
      ({ sql, params } = extractQuery(action));
    } catch (err) {
      return `[postgres:${this.displayLabel}] preview unavailable: ${(err as Error).message}`;
    }
    const paramSummary = params.length > 0 ? ` (params: ${params.length})` : '';
    return `[postgres:${this.displayLabel}] would execute: ${sql.slice(0, 200)}${paramSummary}`;
  }

  async redeemGrant(grant: ExecutionGrant, vault: GrantVault): Promise<void> {
    // The pg.Pool already holds the configured credential. We deposit a
    // non-sensitive marker so Gate 06's vault.assertPresent() invariant
    // passes. In a Vault-issued-short-lived-role deployment, this would
    // fetch a per-grant DB role and store it; for the file-vault
    // composition we have today the pool credential is pre-resolved.
    vault.setSecret(grant, `pg-pool:${this.displayLabel}:${grant.grantId}`);
  }

  async execute(
    action: AgentAction,
    grant: ExecutionGrant,
    vault: GrantVault
  ): Promise<ExecutionResult> {
    vault.assertPresent(grant);
    vault.assertNotExpired(grant);
    const startMs = Date.now();

    // 1. Shape check
    let sql: string;
    let params: readonly unknown[];
    try {
      ({ sql, params } = extractQuery(action));
    } catch (err) {
      return failure(
        grant,
        startMs,
        'INVALID_PAYLOAD',
        (err as Error).message,
        `[postgres:${this.displayLabel}] denied: invalid payload shape`
      );
    }

    // 2. Forbidden DDL and admin verbs are never allowed regardless of capability
    if (isForbidden(sql)) {
      return failure(
        grant,
        startMs,
        'FORBIDDEN_QUERY',
        `verb '${firstSqlVerb(sql)}' is not permitted by the connector`,
        `[postgres:${this.displayLabel}] denied: forbidden verb`
      );
    }

    // 3. Capability ↔ verb consistency
    const capability = action.resolvedCapability ?? '';
    const isReadCap =
      capability.startsWith('read:') ||
      capability === 'execute:query' ||
      capability === 'query:data' ||
      capability === 'search:data';
    const isWriteCap =
      capability.startsWith('create:') ||
      capability.startsWith('update:') ||
      capability.startsWith('delete:') ||
      capability.startsWith('write:');

    if (isReadCap && !isReadOnly(sql)) {
      return failure(
        grant,
        startMs,
        'CAPABILITY_VIOLATION',
        `capability '${capability}' permits read-only queries; received '${firstSqlVerb(sql)}'`,
        `[postgres:${this.displayLabel}] denied: read capability cannot issue ${firstSqlVerb(sql)}`
      );
    }
    if (isWriteCap && !isWrite(sql)) {
      return failure(
        grant,
        startMs,
        'CAPABILITY_VIOLATION',
        `capability '${capability}' permits write queries; received '${firstSqlVerb(sql)}'`,
        `[postgres:${this.displayLabel}] denied: write capability cannot issue ${firstSqlVerb(sql)}`
      );
    }
    if (!isReadCap && !isWriteCap) {
      return failure(
        grant,
        startMs,
        'CAPABILITY_UNRECOGNIZED',
        `capability '${capability}' is not recognized by the postgres connector`,
        `[postgres:${this.displayLabel}] denied: unrecognized capability '${capability}'`
      );
    }

    // 4. Allow-list enforcement
    if (!queryTouchesAllowedTable(sql, this.allowedTables)) {
      return failure(
        grant,
        startMs,
        'TABLE_ACCESS_DENIED',
        `query does not reference an allow-listed table (${this.allowedTables.join(', ')})`,
        `[postgres:${this.displayLabel}] denied: query touches no allow-listed table`
      );
    }

    // 5. Execute
    let result: PgQueryResult;
    try {
      result = await this.executor.query(sql, params);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'unknown postgres error';
      const safe = redactCredentialFragments(raw);
      return failure(
        grant,
        startMs,
        'POSTGRES_QUERY_ERROR',
        safe,
        `[postgres:${this.displayLabel}] query failed: ${safe.slice(0, 200)}`
      );
    }

    // 6. Persist results to the action-scoped payload file. Capped at maxRows
    //    to bound disk pressure; over-cap reads still record the truncated
    //    set + a flag in the metadata so the orchestrator/LLM round-trip
    //    knows the result was clipped.
    const truncated = result.rows.length > this.maxRows;
    const persistedRows = truncated ? result.rows.slice(0, this.maxRows) : result.rows;
    const columns = result.fields?.map(f => f.name) ?? [];
    const payloadDir = path.join(this.payloadsRoot, action.runId);
    const payloadPath = path.join(payloadDir, `${action.actionId}.json`);
    let payloadRelative = path.relative(this.payloadsRoot, payloadPath);
    try {
      await fs.mkdir(payloadDir, { recursive: true });
      const payload = {
        connector: 'postgres',
        systemType: this.systemType,
        actionId: action.actionId,
        runId: action.runId,
        executedAt: new Date().toISOString(),
        sqlVerb: firstSqlVerb(sql),
        rowCount: result.rowCount ?? persistedRows.length,
        columns,
        truncated,
        rows: persistedRows,
      };
      await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (err) {
      // Persistence failure is itself a connector failure — better to surface
      // it than to claim success against a missing payload file.
      const msg = err instanceof Error ? err.message : 'payload write failed';
      return failure(
        grant,
        startMs,
        'PAYLOAD_WRITE_ERROR',
        msg,
        `[postgres:${this.displayLabel}] result persistence failed`
      );
    }

    const verb = firstSqlVerb(sql);
    const rowCount = result.rowCount ?? persistedRows.length;
    const colSummary = columns.length > 0 ? `, columns: ${columns.join(', ')}` : '';
    const truncMarker = truncated ? ` (truncated to ${this.maxRows})` : '';
    const summary = `[postgres:${this.displayLabel}] ${verb} → ${rowCount} row(s)${colSummary}${truncMarker}; payload=${payloadRelative}`;

    return {
      grantId: grant.grantId,
      executedAt: new Date().toISOString(),
      status: 'success',
      responseCode: '200',
      durationMs: Date.now() - startMs,
      redactedSummary: summary.slice(0, 500),
      errorType: null,
      errorMessage: null,
    };
  }

  /** Drain the pool. Bootstrap shutdown should call this. */
  async close(): Promise<void> {
    await this.executor.end();
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Wraps a real pg.Pool in the PgQueryExecutor surface. The factory builds
 * one of these per configured target. The host process owns the lifetime;
 * shutdown should call `.end()` to drain the pool.
 */
class RealPgExecutor implements PgQueryExecutor {
  constructor(private readonly pool: pg.Pool) {}
  async query(text: string, params: readonly unknown[]): Promise<PgQueryResult> {
    const r = await this.pool.query(text, params as unknown[]);
    return {
      rows: r.rows as readonly Record<string, unknown>[],
      rowCount: r.rowCount,
      fields: r.fields,
    };
  }
  async end(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Build a PostgresConnector from factory config. Fails closed if `password`
 * is empty — no fallback default ever, in any environment.
 */
export function buildPostgresConnector(cfg: PostgresConnectorFactoryConfig): PostgresConnector {
  if (!cfg.password || cfg.password.length === 0) {
    throw new Error(
      `PostgresConnector('${cfg.systemType}'): password is required and must be non-empty. ` +
        'Configure via the vault (file:KEY) or env var; no hardcoded fallback exists.'
    );
  }
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: cfg.maxConnections ?? 5,
    connectionTimeoutMillis: cfg.connectionTimeoutMs ?? 5000,
    query_timeout: cfg.queryTimeoutMs ?? 10_000,
    statement_timeout: cfg.statementTimeoutMs ?? 10_000,
    ssl: cfg.ssl ?? false,
  });
  return new PostgresConnector({
    systemType: cfg.systemType,
    executor: new RealPgExecutor(pool),
    allowedTables: cfg.allowedTables,
    payloadsRoot: cfg.payloadsRoot,
    ...(cfg.displayLabel !== undefined ? { displayLabel: cfg.displayLabel } : {}),
    ...(cfg.maxRows !== undefined ? { maxRows: cfg.maxRows } : {}),
  });
}

/**
 * ConnectorFactory registered at bootstrap step 1c so the connector
 * manifest loader's type-presence check passes. Actual instances are
 * constructed in the composition root (scripts/nexus-main.ts) where the
 * SecretSource is in scope and the per-instance password can be resolved
 * fail-closed. Calling .create() through the manifest loader is therefore
 * an architectural error; we throw to surface it loudly. This matches the
 * pattern used by StubConnectorFactory and the workspace/orchestrator/
 * mailbox/compiler factories registered alongside.
 */
export class PostgresConnectorFactory implements ConnectorFactory {
  readonly connectorType = 'postgres' as NonEmpty;

  async create(_configuration: Record<string, unknown>): Promise<Connector> {
    throw new Error(
      'PostgresConnectorFactory.create() is not invoked directly. The composition ' +
        'root constructs PostgresConnector instances with vault-resolved credentials ' +
        'and registers them in the SimpleConnectorRegistry. Use buildPostgresConnector() ' +
        'with a fully-resolved factory config.'
    );
  }
}
