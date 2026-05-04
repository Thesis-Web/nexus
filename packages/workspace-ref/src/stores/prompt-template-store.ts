// packages/workspace-ref/src/stores/prompt-template-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.4 (signature law), §10 gate 9
// Layer 7 — SQLite-backed prompt template store (reference implementation).
//
// Immutable versions. Disabled-not-deleted (hard rule 25).
// Collision → 409 enforced at route layer via exists() check.
// Production: swap for Postgres via PromptTemplateStorePort.

import type { PromptTemplate, PromptTemplateStorePort } from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqlitePromptTemplateStore implements PromptTemplateStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        template_id TEXT NOT NULL,
        version TEXT NOT NULL,
        data_json TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (template_id, version)
      )
    `);
  }

  async list(): Promise<PromptTemplate[]> {
    const rows = this.db
      .prepare('SELECT data_json FROM prompt_templates WHERE disabled = 0')
      .all() as Array<{ data_json: string }>;
    return rows.map(r => JSON.parse(r.data_json) as PromptTemplate);
  }

  async get(id: string, version: string): Promise<PromptTemplate | null> {
    const row = this.db
      .prepare('SELECT data_json FROM prompt_templates WHERE template_id = ? AND version = ?')
      .get(id, version) as { data_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data_json) as PromptTemplate;
  }

  async save(t: PromptTemplate): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO prompt_templates (template_id, version, data_json, disabled)
         VALUES (?, ?, ?, 0)`
      )
      .run(t.templateId, t.version, JSON.stringify(t));
  }

  async disable(id: string, version: string): Promise<void> {
    this.db
      .prepare('UPDATE prompt_templates SET disabled = 1 WHERE template_id = ? AND version = ?')
      .run(id, version);
  }

  async exists(id: string, version: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM prompt_templates WHERE template_id = ? AND version = ?')
      .get(id, version);
    return row !== undefined;
  }
}
