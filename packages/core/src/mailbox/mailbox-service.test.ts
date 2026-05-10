/**
 * Targeted tests for MailboxServiceImpl.findBySlot — the multi-node
 * planner slot-read lookup. The other methods (writeFromOutput,
 * listEligibleForCompile, markConsumed, cancelRun) are exercised by
 * higher-level orchestrator tests; this file covers the new surface.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MailboxServiceImpl } from './mailbox-service.js';
import type {
  MailboxBackend,
  MailboxItem,
  MailboxManifestRecord,
  MailboxStatus,
  NonEmpty,
  Uuid,
  IsoTimestamp,
  Sha256Hex,
  DenialCode,
} from '@nexus/contracts';

// ── Fake backend ─────────────────────────────────────────────────────────────

function fakeBackend(seed: MailboxItem[] = []): MailboxBackend {
  const store: MailboxItem[] = [...seed];
  return {
    backendId: 'fake' as NonEmpty,
    backendVersion: '0' as NonEmpty,
    async write(item) {
      store.push(item);
    },
    async getById(id) {
      return store.find(i => i.mailboxItemId === id) ?? null;
    },
    async listByRun(query) {
      return store.filter(i => i.mailboxId === query.mailboxId && i.runId === query.runId);
    },
    async updateStatus(id, next, reason) {
      const idx = store.findIndex(i => i.mailboxItemId === id);
      if (idx >= 0) {
        store[idx] = { ...store[idx]!, mailboxStatus: next, blockedReason: reason };
      }
      return store[idx]!;
    },
  };
}

// Minimal manifest just to construct the service.
const manifest: MailboxManifestRecord = {
  mailboxId: 'primary' as NonEmpty,
  mailboxType: 'local-jsonl' as NonEmpty,
  enabled: true,
  required: true,
  storageRoot: 'runs/mailbox' as NonEmpty,
  retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
  classificationRequired: false,
  digestRequired: true,
  configuration: {},
};

const RUN_ID = '00000000-0000-4000-a000-000000000aaa' as Uuid;
const NODE_A = '00000000-0000-4000-a000-00000000000a' as Uuid;
const NODE_B = '00000000-0000-4000-a000-00000000000b' as Uuid;

function makeItem(overrides: {
  taskId: Uuid;
  slotId: NonEmpty;
  status?: MailboxStatus;
  createdAt?: IsoTimestamp;
}): MailboxItem {
  return {
    mailboxItemId: ('00000000-0000-4000-a000-' +
      Math.random().toString(16).slice(2, 14).padStart(12, '0')) as Uuid,
    mailboxId: 'primary' as NonEmpty,
    runId: RUN_ID,
    taskId: overrides.taskId,
    agentId: NODE_A,
    slotId: overrides.slotId,
    sourceType: 'nvg_result',
    resultRef: 'file:///tmp/x' as NonEmpty,
    resultDigest: 'a'.repeat(64) as Sha256Hex,
    resultClassifications: [],
    octLevel: 'OCT-OPEN',
    createdAt: overrides.createdAt ?? (new Date().toISOString() as IsoTimestamp),
    expiresAt: null,
    evidenceRecordId: null,
    routingTrailRecordId: null,
    runLedgerEventId: null,
    redactionState: 'not_required',
    mailboxStatus: overrides.status ?? 'available',
    compileEligible: true,
    consumedAt: null,
    blockedReason: null,
  };
}

describe('MailboxServiceImpl.findBySlot', () => {
  let backend: MailboxBackend;
  let service: MailboxServiceImpl;

  beforeEach(() => {
    backend = fakeBackend();
    service = new MailboxServiceImpl(backend, manifest);
  });

  it('returns the unique matching item when one is available', async () => {
    const item = makeItem({ taskId: NODE_A, slotId: 'output' as NonEmpty });
    await backend.write(item);
    const found = await service.findBySlot(
      'primary' as NonEmpty,
      RUN_ID,
      NODE_A,
      'output' as NonEmpty
    );
    expect(found).not.toBeNull();
    expect(found!.mailboxItemId).toBe(item.mailboxItemId);
  });

  it('returns null when no item matches taskId + slotId', async () => {
    await backend.write(makeItem({ taskId: NODE_A, slotId: 'wrong_slot' as NonEmpty }));
    await backend.write(makeItem({ taskId: NODE_B, slotId: 'output' as NonEmpty }));
    const found = await service.findBySlot(
      'primary' as NonEmpty,
      RUN_ID,
      NODE_A,
      'output' as NonEmpty
    );
    expect(found).toBeNull();
  });

  it('skips non-available items (blocked/cancelled/expired/consumed)', async () => {
    await backend.write(
      makeItem({ taskId: NODE_A, slotId: 'output' as NonEmpty, status: 'blocked' })
    );
    await backend.write(
      makeItem({ taskId: NODE_A, slotId: 'output' as NonEmpty, status: 'cancelled' })
    );
    const found = await service.findBySlot(
      'primary' as NonEmpty,
      RUN_ID,
      NODE_A,
      'output' as NonEmpty
    );
    expect(found).toBeNull();
  });

  it('returns the most recently created available item when multiple match', async () => {
    const older = makeItem({
      taskId: NODE_A,
      slotId: 'output' as NonEmpty,
      createdAt: '2026-01-01T00:00:00.000Z' as IsoTimestamp,
    });
    const newer = makeItem({
      taskId: NODE_A,
      slotId: 'output' as NonEmpty,
      createdAt: '2026-01-02T00:00:00.000Z' as IsoTimestamp,
    });
    // Insert in reverse order to ensure ordering depends on createdAt,
    // not insertion order.
    await backend.write(newer);
    await backend.write(older);
    const found = await service.findBySlot(
      'primary' as NonEmpty,
      RUN_ID,
      NODE_A,
      'output' as NonEmpty
    );
    expect(found).not.toBeNull();
    expect(found!.mailboxItemId).toBe(newer.mailboxItemId);
  });

  it('isolates by runId — items from other runs are not returned', async () => {
    const otherRun = '00000000-0000-4000-a000-000000000bbb' as Uuid;
    const otherItem: MailboxItem = {
      ...makeItem({ taskId: NODE_A, slotId: 'output' as NonEmpty }),
      runId: otherRun,
    };
    await backend.write(otherItem);
    const found = await service.findBySlot(
      'primary' as NonEmpty,
      RUN_ID,
      NODE_A,
      'output' as NonEmpty
    );
    expect(found).toBeNull();
  });
});
