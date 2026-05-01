/**
 * Template Registry Store — AMEND-spec-nexus-compile §3
 *
 * File: packages/core/src/compile/template-registry-store.ts
 * Layer 1 — SQLite Zone 1 persistence for signed immutable CompileTemplates.
 *
 * Zone 1 (Registry): persistent, signed, immutable. Rows are never updated.
 * "Latest" = ingested_at DESC for V1 [blueprint §11.4].
 *
 * Existing Nexus DB — shares the same better-sqlite3 Database instance.
 */
import type Database from 'better-sqlite3';
import type {
  CompileTemplate,
  CompileSection,
  CompileGuard,
  CompileFormat,
  DenialHandling,
  NonEmpty,
  IsoTimestamp,
  Sha256Hex,
  Base64Url,
} from '@nexus/contracts';

// ─── Interface [spec §3.2] ───

export interface TemplateRegistryStore {
  initialize(): void;
  ingest(template: CompileTemplate, ingestedBy: NonEmpty): void;
  getByVersion(templateId: NonEmpty, templateVersion: NonEmpty): CompileTemplate | null;
  getLatest(templateId: NonEmpty): CompileTemplate | null;
  listVersions(templateId: NonEmpty): CompileTemplate[];
  listTemplateIds(): NonEmpty[];
  exists(templateId: NonEmpty, templateVersion: NonEmpty): boolean;
}

// ─── Row shape ───

interface TemplateRow {
  template_id: string;
  template_version: string;
  format: string;
  sections_json: string;
  guards_json: string;
  denial_handling: string;
  created_at: string;
  created_by: string;
  template_digest: string;
  signature: string;
  ingested_at: string;
  ingested_by: string;
}

// ─── Implementation ───

export class TemplateRegistryStoreImpl implements TemplateRegistryStore {
  constructor(private readonly db: Database.Database) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compile_templates (
        template_id       TEXT NOT NULL,
        template_version  TEXT NOT NULL,
        format            TEXT NOT NULL,
        sections_json     TEXT NOT NULL,
        guards_json       TEXT NOT NULL,
        denial_handling   TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        created_by        TEXT NOT NULL,
        template_digest   TEXT NOT NULL,
        signature         TEXT NOT NULL,
        ingested_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ingested_by       TEXT NOT NULL,
        PRIMARY KEY (template_id, template_version)
      );
      CREATE INDEX IF NOT EXISTS idx_compile_templates_id
        ON compile_templates (template_id);
      CREATE INDEX IF NOT EXISTS idx_compile_templates_latest
        ON compile_templates (template_id, ingested_at DESC);
    `);
  }

  ingest(template: CompileTemplate, ingestedBy: NonEmpty): void {
    this.db
      .prepare(
        `INSERT INTO compile_templates
         (template_id, template_version, format, sections_json, guards_json,
          denial_handling, created_at, created_by, template_digest, signature, ingested_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        template.templateId,
        template.templateVersion,
        template.format,
        JSON.stringify(template.sections),
        JSON.stringify(template.guards),
        template.denialHandling,
        template.createdAt,
        template.createdBy,
        template.templateDigest,
        template.signature,
        ingestedBy
      );
  }

  getByVersion(templateId: NonEmpty, templateVersion: NonEmpty): CompileTemplate | null {
    const row = this.db
      .prepare('SELECT * FROM compile_templates WHERE template_id = ? AND template_version = ?')
      .get(templateId, templateVersion) as TemplateRow | undefined;
    return row !== undefined ? this.rowToTemplate(row) : null;
  }

  getLatest(templateId: NonEmpty): CompileTemplate | null {
    const row = this.db
      .prepare(
        'SELECT * FROM compile_templates WHERE template_id = ? ORDER BY ingested_at DESC LIMIT 1'
      )
      .get(templateId) as TemplateRow | undefined;
    return row !== undefined ? this.rowToTemplate(row) : null;
  }

  listVersions(templateId: NonEmpty): CompileTemplate[] {
    const rows = this.db
      .prepare('SELECT * FROM compile_templates WHERE template_id = ? ORDER BY ingested_at DESC')
      .all(templateId) as TemplateRow[];
    return rows.map(r => this.rowToTemplate(r));
  }

  listTemplateIds(): NonEmpty[] {
    const rows = this.db
      .prepare('SELECT DISTINCT template_id FROM compile_templates ORDER BY template_id')
      .all() as Array<{ template_id: string }>;
    return rows.map(r => r.template_id as NonEmpty);
  }

  exists(templateId: NonEmpty, templateVersion: NonEmpty): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 FROM compile_templates WHERE template_id = ? AND template_version = ? LIMIT 1'
      )
      .get(templateId, templateVersion);
    return row !== undefined;
  }

  // ─── Private ───

  private rowToTemplate(row: TemplateRow): CompileTemplate {
    return {
      templateId: row.template_id as NonEmpty,
      templateVersion: row.template_version as NonEmpty,
      format: row.format as CompileFormat,
      sections: JSON.parse(row.sections_json) as CompileSection[],
      guards: JSON.parse(row.guards_json) as CompileGuard[],
      denialHandling: row.denial_handling as DenialHandling,
      createdAt: row.created_at as IsoTimestamp,
      createdBy: row.created_by as CompileTemplate['createdBy'],
      templateDigest: row.template_digest as Sha256Hex,
      signature: row.signature as Base64Url,
    };
  }
}
