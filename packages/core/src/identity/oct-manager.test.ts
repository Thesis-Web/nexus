/**
 * OCT Manager Tests — spec §11.3
 * Tests: assignOct — validation, registry update, audit event
 *
 * Uses loadControlPlaneKey() — never generateControlPlaneKeypair().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { assignOct } from './oct-manager.js';
import { SqliteActorRegistry } from './actor-registry.js';
import { initializeSchema } from '../db/schema.js';
import { OCT_LEVEL, ACTOR_CLASS } from '../types/index.js';
import type { Actor, NonEmpty, Uuid } from '../types/index.js';
import { nowIso } from '../utils/time.js';

interface CapturedEvent {
  runId: string;
  eventType: string;
  timestamp: string;
  actorId: string | null;
  detail: Record<string, unknown>;
}

class MockRunLedgerWriter {
  events: CapturedEvent[] = [];
  async writeEvent(event: CapturedEvent): Promise<void> {
    this.events.push(event);
  }
}

// Helper: register a test principal + actor
function registerTestActor(db: Database.Database, octLevel: string = OCT_LEVEL.OPEN): string {
  const principalId = 'p-' + Math.random().toString(36).slice(2, 10);
  const actorId = 'a-' + Math.random().toString(36).slice(2, 10);
  db.prepare(
    `INSERT INTO principals (principal_id, display_name, email, registered_at, max_risk_tier, allowed_systems)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(principalId, 'Test', actorId + '@test.local', nowIso(), 'high', '["stub"]');
  db.prepare(
    `INSERT INTO actors (actor_id, actor_class, principal_id, display_name, environment,
      risk_ceiling, allowed_systems, registered_at, owner, purpose, review_cadence, oct_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actorId,
    ACTOR_CLASS.SUPERVISED_AGENT,
    principalId,
    'Test Agent',
    'dev',
    'medium',
    '["stub"]',
    nowIso(),
    'test',
    'test',
    'weekly',
    octLevel
  );
  return actorId;
}

describe('OCT Manager — spec §11.3', () => {
  let db: Database.Database;
  let registry: SqliteActorRegistry;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    registry = new SqliteActorRegistry(db);
  });

  afterAll(() => {
    db.close();
  });

  it('assignOct updates actor OCT level', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    await assignOct(
      actorId as Uuid,
      OCT_LEVEL.CONFIDENTIAL,
      'test-operator' as NonEmpty,
      registry,
      ledger as any
    );
    const actor = await registry.get(actorId as Uuid);
    expect(actor!.octLevel).toBe(OCT_LEVEL.CONFIDENTIAL);
  });

  it('assignOct emits mandatory audit event', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    await assignOct(
      actorId as Uuid,
      OCT_LEVEL.SECURE,
      'test-operator' as NonEmpty,
      registry,
      ledger as any
    );
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0]!;
    expect(event.eventType).toBe('oct_assignment');
    expect(event.detail).toHaveProperty('actorId', actorId);
    expect(event.detail).toHaveProperty('octLevel', OCT_LEVEL.SECURE);
    expect(event.detail).toHaveProperty('previousOctLevel', OCT_LEVEL.OPEN);
  });

  it('assignOct throws on invalid OCT level', async () => {
    const actorId = registerTestActor(db);
    const ledger = new MockRunLedgerWriter();
    await expect(
      assignOct(actorId as Uuid, 'INVALID', 'op' as NonEmpty, registry, ledger as any)
    ).rejects.toThrow('INVALID_OCT_LEVEL');
  });

  it('assignOct throws on nonexistent actor', async () => {
    const ledger = new MockRunLedgerWriter();
    await expect(
      assignOct('nonexistent' as Uuid, OCT_LEVEL.OPEN, 'op' as NonEmpty, registry, ledger as any)
    ).rejects.toThrow('ACTOR_NOT_FOUND');
  });

  // ── OCT-003 FIX: self-assignment guard ────────────────────────────────────

  it('assignOct throws OCT_SELF_ASSIGNMENT when actor tries to assign own OCT', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    await expect(
      assignOct(
        actorId as Uuid,
        OCT_LEVEL.SECURE,
        actorId as NonEmpty, // operator === actor → self-assignment
        registry,
        ledger as any
      )
    ).rejects.toThrow('OCT_SELF_ASSIGNMENT');
  });
});
