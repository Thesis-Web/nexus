/**
 * MailboxServiceImpl — mailbox-pit V1 allocation surface tests.
 *
 * Spec: AMEND-nexus-mailbox-pit-v0-2-1 §9.1.
 * Covers:
 *   - allocateForRun: idempotency, deterministic derivation, ledger emission, persistence/reconstruction
 *   - getMailboxForActor: null on unknown, correct on known, restart-recovery via ledger
 *   - listMailboxesForRun: empty / populated, cross-run isolation
 *   - resolveMailboxProvenance: typed MailboxAllocation, null on unknown
 *   - assertMailboxBelongsToActor: pass on match, throw on mismatch (MAILBOX_OWNERSHIP_MISMATCH)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  MailboxBackend,
  MailboxManifestRecord,
  MailboxItem,
  RunLedgerEntry,
  RunLedgerWriter,
  Uuid,
  NonEmpty,
  DenialCode,
  IsoTimestamp,
} from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import { MailboxServiceImpl } from './mailbox-service.js';
import { encodeMailboxIdV1 } from './mailbox-id-format.js';

// ─── fakes ───────────────────────────────────────────────────────────────

function fakeBackend(): MailboxBackend {
  const store: MailboxItem[] = [];
  return {
    backendId: 'fake-backend' as NonEmpty,
    backendVersion: '1.0.0' as NonEmpty,
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

function makeLedgerWriter(): RunLedgerWriter & {
  events: Array<Omit<RunLedgerEntry, 'entryId'>>;
} {
  const events: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    events,
    writeEvent: async (entry: Omit<RunLedgerEntry, 'entryId'>) => {
      events.push(entry);
    },
    getByRunId: async (runId: Uuid) => {
      return events
        .filter(e => e.runId === runId)
        .map(
          (e, i): RunLedgerEntry => ({
            entryId: `00000000-0000-4000-a000-${i.toString().padStart(12, '0')}` as Uuid,
            ...e,
          })
        );
    },
    tail: async () => [],
    getLatestRunId: async () => null,
  };
}

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

const RUN_A = '11111111-1111-4111-8111-111111111111' as Uuid;
const RUN_B = '22222222-2222-4222-8222-222222222222' as Uuid;
const ACTOR_1 = '33333333-3333-4333-8333-333333333333' as Uuid;
const ACTOR_2 = '44444444-4444-4444-8444-444444444444' as Uuid;
const ACTOR_3 = '55555555-5555-4555-8555-555555555555' as Uuid;

// ─── tests ───────────────────────────────────────────────────────────────

describe('MailboxServiceImpl.allocateForRun', () => {
  it('derives the canonical V1 mailboxId for each actor', async () => {
    const ledger = makeLedgerWriter();
    const service = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    const result = await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);

    expect(result.get(ACTOR_1)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_1));
    expect(result.get(ACTOR_2)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_2));
  });

  it('emits one mailbox_allocated event per new actor', async () => {
    const ledger = makeLedgerWriter();
    const service = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);

    const allocEvents = ledger.events.filter(e => e.eventType === 'mailbox_allocated');
    expect(allocEvents).toHaveLength(2);
    expect(allocEvents.map(e => e.actorId).sort()).toEqual([ACTOR_1, ACTOR_2].sort());
    for (const e of allocEvents) {
      expect((e.detail as { allocationVersion: string }).allocationVersion).toBe('mailbox-pit/v1');
      expect((e.detail as { mailboxRole: string }).mailboxRole).toBe('agent_output');
      expect((e.detail as { backendId: string }).backendId).toBe('fake-backend');
    }
  });

  it('is idempotent — second call for same actors does not re-emit events', async () => {
    const ledger = makeLedgerWriter();
    const service = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);

    const allocEvents = ledger.events.filter(e => e.eventType === 'mailbox_allocated');
    expect(allocEvents).toHaveLength(2);
  });

  it('returns the same mailboxIds across calls (deterministic)', async () => {
    const ledger = makeLedgerWriter();
    const service = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    const r1 = await service.allocateForRun(RUN_A, [ACTOR_1]);
    const r2 = await service.allocateForRun(RUN_A, [ACTOR_1]);
    expect(r1.get(ACTOR_1)).toBe(r2.get(ACTOR_1));
  });

  it('extending the actor set adds new allocations only', async () => {
    const ledger = makeLedgerWriter();
    const service = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    await service.allocateForRun(RUN_A, [ACTOR_1]);
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);
    expect(ledger.events.filter(e => e.eventType === 'mailbox_allocated')).toHaveLength(2);
  });
});

describe('MailboxServiceImpl.getMailboxForActor', () => {
  it('returns null for an unknown actor', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    expect(await service.getMailboxForActor(RUN_A, ACTOR_1)).toBeNull();
  });

  it('returns the canonical mailboxId after allocation', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1]);
    expect(await service.getMailboxForActor(RUN_A, ACTOR_1)).toBe(
      encodeMailboxIdV1(RUN_A, ACTOR_1)
    );
  });

  it('recovers allocations from the ledger after a service restart', async () => {
    // Same ledger, fresh service — simulates process restart.
    const ledger = makeLedgerWriter();
    const sA = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    await sA.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);

    const sB = new MailboxServiceImpl(fakeBackend(), manifest, ledger);
    expect(await sB.getMailboxForActor(RUN_A, ACTOR_1)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_1));
    expect(await sB.getMailboxForActor(RUN_A, ACTOR_2)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_2));
  });
});

describe('MailboxServiceImpl.listMailboxesForRun', () => {
  it('returns an empty map for an un-allocated run', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    const list = await service.listMailboxesForRun(RUN_A);
    expect(list.size).toBe(0);
  });

  it('returns all per-actor mailboxes after allocation', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2, ACTOR_3]);
    const list = await service.listMailboxesForRun(RUN_A);
    expect(list.size).toBe(3);
    expect(list.get(ACTOR_1)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_1));
    expect(list.get(ACTOR_2)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_2));
    expect(list.get(ACTOR_3)).toBe(encodeMailboxIdV1(RUN_A, ACTOR_3));
  });

  it('isolates allocations across runs', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1]);
    await service.allocateForRun(RUN_B, [ACTOR_2]);

    const listA = await service.listMailboxesForRun(RUN_A);
    const listB = await service.listMailboxesForRun(RUN_B);
    expect(listA.size).toBe(1);
    expect(listB.size).toBe(1);
    expect(listA.has(ACTOR_2)).toBe(false);
    expect(listB.has(ACTOR_1)).toBe(false);
  });
});

describe('MailboxServiceImpl.resolveMailboxProvenance', () => {
  it('returns a typed MailboxAllocation for a known mailbox', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1]);
    const mailboxId = encodeMailboxIdV1(RUN_A, ACTOR_1);
    const allocation = await service.resolveMailboxProvenance(RUN_A, mailboxId);
    expect(allocation).not.toBeNull();
    expect(allocation!.actorId).toBe(ACTOR_1);
    expect(allocation!.runId).toBe(RUN_A);
    expect(allocation!.mailboxRole).toBe('agent_output');
    expect(allocation!.allocationVersion).toBe('mailbox-pit/v1');
    expect(allocation!.backendId).toBe('fake-backend');
  });

  it('returns null for an unknown mailbox', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1]);
    const bogus = 'mbx-v1-run-bogus-actor-bogus' as NonEmpty;
    expect(await service.resolveMailboxProvenance(RUN_A, bogus)).toBeNull();
  });

  it('returns null when the run has no allocations at all', async () => {
    const service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    const someMb = encodeMailboxIdV1(RUN_A, ACTOR_1);
    expect(await service.resolveMailboxProvenance(RUN_A, someMb)).toBeNull();
  });
});

describe('MailboxServiceImpl.assertMailboxBelongsToActor', () => {
  let service: MailboxServiceImpl;

  beforeEach(async () => {
    service = new MailboxServiceImpl(fakeBackend(), manifest, makeLedgerWriter());
    await service.allocateForRun(RUN_A, [ACTOR_1, ACTOR_2]);
  });

  it('passes silently when the mailbox belongs to the actor', async () => {
    const mb = encodeMailboxIdV1(RUN_A, ACTOR_1);
    await expect(service.assertMailboxBelongsToActor(RUN_A, ACTOR_1, mb)).resolves.toBeUndefined();
  });

  it('throws MAILBOX_OWNERSHIP_MISMATCH when the mailbox belongs to a different actor', async () => {
    const wrongMb = encodeMailboxIdV1(RUN_A, ACTOR_2);
    await expect(
      service.assertMailboxBelongsToActor(RUN_A, ACTOR_1, wrongMb)
    ).rejects.toMatchObject({
      denialCode: DENIAL_CODE.MAILBOX_OWNERSHIP_MISMATCH as DenialCode,
    });
  });

  it('throws when the actor has no allocation in this run', async () => {
    const someMb = encodeMailboxIdV1(RUN_A, ACTOR_3);
    await expect(service.assertMailboxBelongsToActor(RUN_A, ACTOR_3, someMb)).rejects.toMatchObject(
      {
        denialCode: DENIAL_CODE.MAILBOX_OWNERSHIP_MISMATCH as DenialCode,
      }
    );
  });
});

// IsoTimestamp import used implicitly via RunLedgerEntry.timestamp; reference
// to keep tsc from flagging the type import as unused in some configurations.
void (null as unknown as IsoTimestamp);
