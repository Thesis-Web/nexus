import Database from 'better-sqlite3';
import path from 'node:path';
import { initializeSchema, migrateSchema } from '@nexus/core';

export function openDb(): Database.Database {
  const dbPath = process.env['NEXUS_DB_PATH'] ?? path.join(process.cwd(), 'nexus.db');
  const db = new Database(dbPath);
  initializeSchema(db);
  // Idempotent migration for existing databases — adds columns the
  // initializeSchema CREATE TABLE IF NOT EXISTS path can't add to a table
  // that already exists. Without this, schema changes silently never reach
  // running deployments.
  migrateSchema(db);
  return db;
}
