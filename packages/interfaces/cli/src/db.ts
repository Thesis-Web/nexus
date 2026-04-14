import Database from 'better-sqlite3';
import path from 'node:path';
import { initializeSchema } from '@nexus/core';

export function openDb(): Database.Database {
  const dbPath = process.env['NEXUS_DB_PATH'] ?? path.join(process.cwd(), 'nexus.db');
  const db = new Database(dbPath);
  initializeSchema(db);
  return db;
}
