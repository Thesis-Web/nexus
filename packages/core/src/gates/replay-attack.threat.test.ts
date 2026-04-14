/**
 * Threat test 1 — Replay Attack
 * Spec §17.1, §27.2 item 1
 * Same actionId submitted twice → second must produce denied_threat.
 * ReplayDetector is SQLite-backed; survives process restarts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ReplayDetector } from '../security/replay-detector.js';
import { NexusSecurityViolation } from '../types/index.js';
import { DENIAL_CODE } from '../types/index.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS replay_cache (
      action_id TEXT PRIMARY KEY,
      seen_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delegation_sequences (
      delegation_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('Threat: Replay Attack (spec §17.1)', () => {
  let detector: ReplayDetector;

  beforeEach(() => {
    detector = new ReplayDetector(makeDb());
  });

  it('accepts a fresh actionId on first submission', () => {
    const actionId = randomUUID();
    // Should not throw
    expect(() => detector.check(actionId)).not.toThrow();
  });

  it('rejects the same actionId on second submission with NexusSecurityViolation', () => {
    const actionId = randomUUID();
    detector.check(actionId); // first — OK
    expect(() => detector.check(actionId)).toThrow(NexusSecurityViolation);
  });

  it('violation carries REPLAY_DETECTED denial code', () => {
    const actionId = randomUUID();
    detector.check(actionId);
    try {
      detector.check(actionId);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NexusSecurityViolation);
      expect((err as NexusSecurityViolation).denialCode).toBe(DENIAL_CODE.REPLAY_DETECTED);
    }
  });

  it('different actionIds are each accepted independently', () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(() => detector.check(a)).not.toThrow();
    expect(() => detector.check(b)).not.toThrow();
  });

  it('replay is still rejected after a distinct second action is accepted', () => {
    const first = randomUUID();
    const second = randomUUID();
    detector.check(first);
    detector.check(second);
    expect(() => detector.check(first)).toThrow(NexusSecurityViolation);
  });
});
