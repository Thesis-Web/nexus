/**
 * OCT Manager Tests — spec §11.3
 * Tests: assignOct — signed operator verification, validation, registry update, audit event
 *
 * OCT-003 FIX: Full signed operator action verification.
 * Uses loadControlPlaneKey() to get a dev keypair, writes its public key
 * to keys/admins/<operatorId>.public.json for verification.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import * as path from 'path';
import { assignOct } from './oct-manager.js';
import type { SignedOctAssignmentRequest } from './oct-manager.js';
import { SqliteActorRegistry } from './actor-registry.js';
import { initializeSchema } from '../db/schema.js';
import { OCT_LEVEL, ACTOR_CLASS } from '../types/index.js';
import type { NonEmpty, Uuid, IsoTimestamp, Base64Url } from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';

class MockRunLedgerWriter {
  events: Array<Record<string, unknown>> = [];
  async writeEvent(entry: Record<string, unknown>): Promise<void> {
    this.events.push(entry);
  }
  async getByRunId(): Promise<unknown[]> {
    return [];
  }
  async tail(): Promise<unknown[]> {
    return [];
  }
  async getLatestRunId(): Promise<null> {
    return null;
  }
}

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
    'high',
    '["stub"]',
    nowIso(),
    'test-owner',
    'testing',
    '90d',
    octLevel
  );
  return actorId;
}

describe('OCT Manager — spec §11.3', () => {
  let db: Database.Database;
  let registry: SqliteActorRegistry;
  let operatorKeyPair: Awaited<ReturnType<typeof loadControlPlaneKey>>;
  const operatorId = 'test-operator' as NonEmpty;
  const adminKeyDir = path.join('keys', 'admins');

  async function buildSignedRequest(
    overrides: Partial<SignedOctAssignmentRequest> & { actorId: Uuid; newOctLevel: string }
  ): Promise<SignedOctAssignmentRequest> {
    const req = {
      action: (overrides.action ?? 'oct_change') as 'oct_assignment' | 'oct_change',
      actorId: overrides.actorId,
      previousOctLevel: (overrides.previousOctLevel ?? OCT_LEVEL.OPEN) as any,
      newOctLevel: overrides.newOctLevel as any,
      operatorId: (overrides.operatorId ?? operatorId) as NonEmpty,
      requestedAt: (overrides.requestedAt ?? nowIso()) as IsoTimestamp,
      reason: (overrides.reason ?? 'test assignment') as NonEmpty,
    };
    const payload = canonicalize(req);
    const signature = await sign(payload, operatorKeyPair);
    return { ...req, signature } as SignedOctAssignmentRequest;
  }

  beforeAll(async () => {
    db = new Database(':memory:');
    initializeSchema(db);
    registry = new SqliteActorRegistry(db);

    // Load dev keypair and write its public key as admin key
    operatorKeyPair = await loadControlPlaneKey();
    await fs.mkdir(adminKeyDir, { recursive: true });
    await fs.writeFile(
      path.join(adminKeyDir, `${operatorId}.public.json`),
      JSON.stringify({ publicKey: operatorKeyPair.publicKey }),
      'utf-8'
    );
  });

  afterAll(async () => {
    db.close();
    // Clean up admin key file
    try {
      await fs.unlink(path.join(adminKeyDir, `${operatorId}.public.json`));
    } catch {
      /* ignore */
    }
  });

  // ── §11.3: signed OCT change ──────────────────────────────────────────────

  it('assignOct changes OCT level with valid signed request', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: OCT_LEVEL.CONFIDENTIAL,
      previousOctLevel: OCT_LEVEL.OPEN as any,
    });
    await assignOct(request, registry, ledger as any);

    const actor = await registry.get(actorId as Uuid);
    expect(actor!.octLevel).toBe(OCT_LEVEL.CONFIDENTIAL);
  });

  it('assignOct emits mandatory audit event with signatureHash', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: OCT_LEVEL.SECURE,
      previousOctLevel: OCT_LEVEL.OPEN as any,
    });
    await assignOct(request, registry, ledger as any);

    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0]!;
    expect(event['eventType']).toBe('oct_assignment');
    expect((event['detail'] as any).signatureHash).toBeTruthy();
    expect((event['detail'] as any).operatorId).toBe(operatorId);
  });

  // ── §11.3: validation errors ──────────────────────────────────────────────

  it('rejects invalid OCT level', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: 'OCT-INVALID' as any,
    });
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow('INVALID_OCT_LEVEL');
  });

  it('rejects self-assignment (operatorId === actorId)', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: OCT_LEVEL.SECURE,
      operatorId: actorId as NonEmpty,
    });
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow(
      'OCT_SELF_ASSIGNMENT'
    );
  });

  it('rejects unknown operator (no public key file)', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: OCT_LEVEL.SECURE,
      operatorId: 'unknown-operator' as NonEmpty,
    });
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow(
      'OCT_UNKNOWN_OPERATOR'
    );
  });

  it('rejects invalid signature (tampered payload)', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      newOctLevel: OCT_LEVEL.SECURE,
    });
    // Tamper with the request after signing
    request.reason = 'tampered reason' as NonEmpty;
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow(
      'OCT_INVALID_SIGNATURE'
    );
  });

  it('rejects nonexistent actor', async () => {
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: 'nonexistent' as Uuid,
      newOctLevel: OCT_LEVEL.OPEN,
    });
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow('ACTOR_NOT_FOUND');
  });

  it('rejects oct_change with mismatched previousOctLevel', async () => {
    const actorId = registerTestActor(db, OCT_LEVEL.OPEN);
    const ledger = new MockRunLedgerWriter();
    const request = await buildSignedRequest({
      actorId: actorId as Uuid,
      action: 'oct_change',
      newOctLevel: OCT_LEVEL.SECURE,
      previousOctLevel: OCT_LEVEL.CONFIDENTIAL as any, // wrong — actor is OCT-OPEN
    });
    await expect(assignOct(request, registry, ledger as any)).rejects.toThrow(
      'OCT_PREVIOUS_MISMATCH'
    );
  });
});
