/**
 * SQLite schema initialization — spec §20.1
 *
 * All six tables. Initialized at startup.
 * Column-by-column storage — no JSON blob for indexed fields.
 */
import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS principals (
      principal_id      TEXT PRIMARY KEY,
      display_name      TEXT NOT NULL,
      email             TEXT NOT NULL UNIQUE,
      registered_at     TEXT NOT NULL,
      max_risk_tier     TEXT NOT NULL,
      allowed_systems   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actors (
      actor_id            TEXT PRIMARY KEY,
      actor_class         TEXT NOT NULL,
      principal_id        TEXT NOT NULL REFERENCES principals(principal_id),
      display_name        TEXT NOT NULL,
      environment         TEXT NOT NULL,
      risk_ceiling        TEXT NOT NULL,
      allowed_systems     TEXT NOT NULL,
      registered_at       TEXT NOT NULL,
      owner               TEXT,
      purpose             TEXT,
      review_cadence      TEXT,
      oct_level             TEXT DEFAULT NULL,
      allowed_capabilities  TEXT NOT NULL DEFAULT '[]',
      enabled               INTEGER NOT NULL DEFAULT 1,
      approver_public_key   TEXT,
      approver_channels     TEXT,
      roles                 TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_actors_principal   ON actors(principal_id);
    CREATE INDEX IF NOT EXISTS idx_actors_environment ON actors(environment);
    CREATE INDEX IF NOT EXISTS idx_actors_class       ON actors(actor_class);

    CREATE TABLE IF NOT EXISTS sessions (
      session_id    TEXT PRIMARY KEY,
      actor_id      TEXT NOT NULL REFERENCES actors(actor_id),
      principal_id  TEXT NOT NULL REFERENCES principals(principal_id),
      delegation_id TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_actor   ON sessions(actor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS delegations (
      delegation_id               TEXT PRIMARY KEY,
      principal_id                TEXT NOT NULL REFERENCES principals(principal_id),
      actor_id                    TEXT NOT NULL REFERENCES actors(actor_id),
      parent_delegation_id        TEXT REFERENCES delegations(delegation_id),
      chain_depth                 INTEGER NOT NULL DEFAULT 0,
      max_chain_depth             INTEGER NOT NULL DEFAULT 3,
      allowed_systems             TEXT NOT NULL,
      allowed_capabilities        TEXT NOT NULL,
      forbidden_capabilities      TEXT NOT NULL,
      max_risk_tier               TEXT NOT NULL,
      allow_downstream_propagation INTEGER NOT NULL DEFAULT 0,
      environment                 TEXT NOT NULL,
      minted_at                   TEXT NOT NULL,
      expires_at                  TEXT NOT NULL,
      minted_by                   TEXT NOT NULL,
      signature                   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delegations_actor   ON delegations(actor_id);
    CREATE INDEX IF NOT EXISTS idx_delegations_expires ON delegations(expires_at);
    CREATE INDEX IF NOT EXISTS idx_delegations_parent  ON delegations(parent_delegation_id);

    CREATE TABLE IF NOT EXISTS replay_cache (
      action_id TEXT PRIMARY KEY,
      seen_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delegation_sequences (
      delegation_id  TEXT PRIMARY KEY,
      last_sequence  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pending_approvals (
      approval_id   TEXT PRIMARY KEY,
      action_id     TEXT NOT NULL,
      template_id   TEXT NOT NULL,
      request_json  TEXT NOT NULL,
      channel_id    TEXT NOT NULL,
      dispatched_at TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      response_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_status  ON pending_approvals(status);
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_expires ON pending_approvals(expires_at);
  `);
}

/**
 * Migration: add columns for existing databases. Idempotent.
 * Exported so every db-open path can run it (the CLI's `openDb()` and the
 * helper `openDatabase()` below). Fresh installs pick up new columns via
 * `initializeSchema`; upgrades pick them up here.
 */
export function migrateSchema(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(actors)').all() as Array<{ name: string }>;
  const names = new Set(cols.map(c => c.name));
  if (!names.has('oct_level')) db.exec('ALTER TABLE actors ADD COLUMN oct_level TEXT DEFAULT NULL');
  if (!names.has('allowed_capabilities'))
    db.exec("ALTER TABLE actors ADD COLUMN allowed_capabilities TEXT NOT NULL DEFAULT '[]'");
  if (!names.has('enabled'))
    db.exec('ALTER TABLE actors ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  // HOLE-A02 closure: per-actor roles in the governed Actor record. Existing
  // rows default to an empty array and therefore fail hasAdminRole() until a
  // signed admin action grants them roles. Bootstrap performs a one-shot seed
  // for the dev-admin actor so existing deployments don't lose admin access.
  if (!names.has('roles'))
    db.exec("ALTER TABLE actors ADD COLUMN roles TEXT NOT NULL DEFAULT '[]'");
}

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  migrateSchema(db);
  return db;
}
