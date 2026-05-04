// packages/workspace-ref/src/stores/workspace-file-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §6.4, §6.5
// Layer 7 — SQLite-backed file metadata store (reference implementation).
//
// Tracks WorkspaceFileReference lifecycle: staged → bound or quarantined.
// Quarantined files cannot be rebound. Production: swap via WorkspaceFileStorePort.

import type {
  WorkspaceFileReference,
  WorkspaceFileStorePort,
  Uuid,
  IsoTimestamp,
  Sha256Hex,
} from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqliteWorkspaceFileStore implements WorkspaceFileStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_files (
        file_id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        declared_filename TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        classification_labels TEXT NOT NULL DEFAULT '[]',
        provenance TEXT NOT NULL DEFAULT 'user_upload',
        stored_at TEXT NOT NULL,
        run_id TEXT,
        uploaded_by_principal_id TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'staged',
        quarantine_reason TEXT
      )
    `);
  }

  store(file: WorkspaceFileReference): void {
    this.db
      .prepare(
        `INSERT INTO workspace_files
         (file_id, sha256, declared_filename, media_type, size_bytes,
          classification_labels, provenance, stored_at, run_id,
          uploaded_by_principal_id, uploaded_at, status, quarantine_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        file.fileId,
        file.sha256,
        file.declaredFilename,
        file.mediaType,
        file.sizeBytes,
        JSON.stringify(file.classificationLabels),
        file.provenance,
        file.storedAt,
        file.runId,
        file.uploadedByPrincipalId,
        file.uploadedAt,
        file.status,
        file.quarantineReason ?? null
      );
  }

  get(fileId: Uuid): WorkspaceFileReference | null {
    const row = this.db.prepare('SELECT * FROM workspace_files WHERE file_id = ?').get(fileId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.toRef(row);
  }

  getByPrincipal(principalId: string): WorkspaceFileReference[] {
    const rows = this.db
      .prepare('SELECT * FROM workspace_files WHERE uploaded_by_principal_id = ?')
      .all(principalId) as Record<string, unknown>[];
    return rows.map(r => this.toRef(r));
  }

  bindToRun(fileId: Uuid, runId: Uuid, labels: string[]): void {
    this.db
      .prepare(
        `UPDATE workspace_files
         SET run_id = ?, status = 'bound', classification_labels = ?
         WHERE file_id = ? AND status = 'staged'`
      )
      .run(runId, JSON.stringify(labels), fileId);
  }

  markQuarantined(fileId: Uuid, reason: string, labels: string[]): void {
    this.db
      .prepare(
        `UPDATE workspace_files
         SET status = 'quarantined', quarantine_reason = ?, classification_labels = ?
         WHERE file_id = ?`
      )
      .run(reason, JSON.stringify(labels), fileId);
  }

  private toRef(row: Record<string, unknown>): WorkspaceFileReference {
    return {
      fileId: row['file_id'] as Uuid,
      sha256: row['sha256'] as Sha256Hex,
      declaredFilename: row['declared_filename'] as string,
      mediaType: row['media_type'] as string,
      sizeBytes: row['size_bytes'] as number,
      classificationLabels: JSON.parse(row['classification_labels'] as string) as string[],
      provenance: row['provenance'] as 'user_upload',
      storedAt: row['stored_at'] as string,
      runId: (row['run_id'] as Uuid) ?? null,
      uploadedByPrincipalId: row['uploaded_by_principal_id'] as string,
      uploadedAt: row['uploaded_at'] as IsoTimestamp,
      status: row['status'] as 'staged' | 'bound' | 'quarantined',
      ...(row['quarantine_reason'] != null
        ? { quarantineReason: row['quarantine_reason'] as string }
        : {}),
    };
  }
}
