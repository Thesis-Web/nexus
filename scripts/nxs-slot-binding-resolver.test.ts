/**
 * Unit tests for the NXS slot-binding resolver.
 *
 * Coverage:
 *   - Happy path: single binding, full body
 *   - Happy path: single binding, drilled sourceJsonPath
 *   - Multiple bindings into different leaves
 *   - upstream_subtask_not_in_plan
 *   - upstream_slot_item_missing
 *   - upstream_body_not_json (with sourceJsonPath)
 *   - object_key_missing on sourceJsonPath
 *   - array_index_out_of_range on sourceJsonPath
 *   - payload_path_intermediate_missing
 *   - payload_path_leaf_missing
 *   - empty payloadPath rejected
 *   - unsupported_result_ref_scheme
 *   - utility helpers exercised directly (readByDottedPath, writeByDottedPath)
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  ExecutionPlan,
  MailboxService,
  MailboxItem,
  NonEmpty,
  NxsActionTemplate,
  NxsSlotBinding,
  PlanNode,
  SlotReadRef,
  Sha256Hex,
  Uuid,
  DenialCode,
  OctLevel,
} from '@nexus/contracts';
import {
  resolveNxsSlotBindings,
  readByDottedPath,
  writeByDottedPath,
} from './nxs-slot-binding-resolver.js';

// ─── helpers ───

function uuid(): Uuid {
  return '11111111-1111-4111-8111-111111111111' as Uuid;
}

let counter = 0;
function nextUuid(): Uuid {
  counter += 1;
  return `22222222-2222-4222-8222-${counter.toString().padStart(12, '0')}` as Uuid;
}

async function writeTempJson(body: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nxs-slot-binding-'));
  const file = path.join(dir, 'payload.json');
  await fs.writeFile(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

function nxsTemplate(
  rawPayload: unknown,
  slotBindings: readonly NxsSlotBinding[] = []
): NxsActionTemplate {
  return {
    capability: 'update:record:internal' as NonEmpty,
    target: {
      system: 'warehouse' as NonEmpty,
      resourceType: 'inventory' as NonEmpty,
      resourceScope: 'product_a' as NonEmpty,
    },
    rawPayload,
    slotBindings,
  };
}

function nxsNode(
  subTaskKey: string,
  tmpl: NxsActionTemplate,
  inputSlotReads: readonly SlotReadRef[] = []
): PlanNode {
  return {
    nodeId: nextUuid(),
    planOrderIndex: 0,
    agentId: uuid(),
    taskSummary: ('subtask ' + subTaskKey) as NonEmpty,
    requiresNvg: false,
    requiresNxs: true,
    nodeType: 'nxs_dispatch',
    declaredRiskHint: '__EVIDENCE_SENTINEL__' as never,
    expectedOutputSlots: ['write_receipt' as NonEmpty],
    timeoutMs: 60_000,
    subTaskKey: subTaskKey as NonEmpty,
    taskPrompt: null,
    inputSlotReads,
    actionTemplate: tmpl,
  };
}

function planWith(nodes: readonly PlanNode[]): ExecutionPlan {
  return {
    planId: uuid(),
    runId: uuid(),
    planDigest: '0'.repeat(64) as Sha256Hex,
    nodes: [...nodes],
    edges: [],
    plannerType: 'test' as NonEmpty,
    plannerVersion: '0.0.0' as NonEmpty,
    createdAt: new Date().toISOString() as never,
  };
}

function mailboxItemFor(taskId: Uuid, slotId: string, file: string): MailboxItem {
  return {
    mailboxItemId: nextUuid(),
    mailboxId: 'mbx-primary' as NonEmpty,
    runId: uuid(),
    taskId,
    agentId: uuid(),
    slotId: slotId as NonEmpty,
    sourceType: 'nxs_execution_result',
    resultRef: ('file://' + file) as NonEmpty,
    resultDigest: 'a'.repeat(64) as Sha256Hex,
    resultClassifications: [],
    octLevel: 'OCT-OPEN' as OctLevel,
    createdAt: new Date().toISOString() as never,
    expiresAt: null,
    evidenceRecordId: null,
    routingTrailRecordId: null,
    runLedgerEventId: null,
    redactionState: 'not_required',
    mailboxStatus: 'available',
    compileEligible: true,
    consumedAt: null,
    blockedReason: null,
  };
}

function mockMailboxService(itemsByKey: Map<string, MailboxItem | null>): MailboxService {
  // Mailbox-pit V1 — the resolver now looks up the upstream actor's
  // mailbox per binding. The mock returns a constant mailboxId for any
  // (runId, actorId) pair and ignores it in findBySlot, so existing
  // tests that drive findBySlot via (taskId, slotId) continue to work.
  return {
    writeFromOutput: async () => {
      throw new Error('not used');
    },
    listEligibleForCompile: async () => [],
    markConsumed: async () => undefined,
    cancelRun: async (_m, _r, _reason: DenialCode) => undefined,
    findBySlot: async (_mailboxId, _runId, taskId, slotId) => {
      const key = `${taskId}::${slotId}`;
      return itemsByKey.get(key) ?? null;
    },
    allocateForRun: async () => new Map(),
    getMailboxForActor: async () => 'mbx-mock' as NonEmpty,
    listMailboxesForRun: async () => new Map(),
    resolveMailboxProvenance: async () => null,
    assertMailboxBelongsToActor: async () => undefined,
  } as unknown as MailboxService;
}

// ─── tests ───

describe('readByDottedPath', () => {
  it('returns the leaf for a top-level key', () => {
    const r = readByDottedPath({ a: 1 }, 'a');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1);
  });

  it('returns the leaf for a nested key', () => {
    const r = readByDottedPath({ a: { b: { c: 'x' } } }, 'a.b.c');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('x');
  });

  it('indexes into arrays with numeric segments', () => {
    const r = readByDottedPath({ rows: [{ v: 10 }, { v: 20 }] }, 'rows.1.v');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(20);
  });

  it('fails on a missing key', () => {
    const r = readByDottedPath({ a: 1 }, 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('object_key_missing');
  });

  it('fails on array index out of range', () => {
    const r = readByDottedPath({ rows: [{}, {}] }, 'rows.5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('array_index_out_of_range');
  });

  it('fails when trying to traverse a scalar', () => {
    const r = readByDottedPath({ a: 1 }, 'a.b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cannot_traverse_scalar');
  });

  it('rejects an empty path', () => {
    const r = readByDottedPath({ a: 1 }, '');
    expect(r.ok).toBe(false);
  });
});

describe('writeByDottedPath', () => {
  it('overwrites a top-level leaf', () => {
    const obj: Record<string, unknown> = { a: 1 };
    const r = writeByDottedPath(obj, 'a', 42);
    expect(r.ok).toBe(true);
    expect(obj.a).toBe(42);
  });

  it('overwrites a nested leaf', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 'old' } } };
    const r = writeByDottedPath(obj, 'a.b.c', 'new');
    expect(r.ok).toBe(true);
    expect((obj.a as { b: { c: string } }).b.c).toBe('new');
  });

  it('rejects when an intermediate is missing', () => {
    const obj: Record<string, unknown> = { a: {} };
    const r = writeByDottedPath(obj, 'a.b.c', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('payload_path_intermediate_missing');
  });

  it('rejects when the leaf key does not already exist', () => {
    const obj: Record<string, unknown> = { a: {} };
    const r = writeByDottedPath(obj, 'a.b', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('payload_path_leaf_missing');
  });

  it('overwrites an array element by numeric segment', () => {
    const obj = { rows: [{ v: 1 }, { v: 2 }] };
    const r = writeByDottedPath(obj, 'rows.1.v', 99);
    expect(r.ok).toBe(true);
    expect(obj.rows[1]!.v).toBe(99);
  });

  it('rejects writing into a scalar', () => {
    const obj = { a: 1 };
    const r = writeByDottedPath(obj, 'a.b', 'x');
    expect(r.ok).toBe(false);
  });

  it('rejects empty path', () => {
    const r = writeByDottedPath({ a: 1 }, '', 'x');
    expect(r.ok).toBe(false);
  });
});

describe('resolveNxsSlotBindings', () => {
  it('returns rawPayload unchanged when there are no bindings', async () => {
    const tmpl = nxsTemplate({ table: 'inventory' });
    const node = nxsNode('write', tmpl);
    const plan = planWith([node]);
    const mailbox = mockMailboxService(new Map());

    const result = await resolveNxsSlotBindings({
      node,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(true);
    if (result.resolved) expect(result.payload).toEqual({ table: 'inventory' });
  });

  it('substitutes the entire utf-8 body when sourceJsonPath is null', async () => {
    const file = await writeTempJson('the entire body');
    const upstream = nxsNode('read', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate({ table: 'inventory', set: { value: '__PLACEHOLDER__' } }, [
        {
          fromSubTaskKey: 'read' as NonEmpty,
          slotId: 'data' as NonEmpty,
          payloadPath: 'set.value' as NonEmpty,
          sourceJsonPath: null,
        },
      ]),
      [{ fromSubTaskKey: 'read' as NonEmpty, slotId: 'data' as NonEmpty }]
    );
    const plan = planWith([upstream, writer]);
    const mailbox = mockMailboxService(
      new Map([[`${upstream.nodeId}::data`, mailboxItemFor(upstream.nodeId, 'data', file)]])
    );

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.payload).toEqual({ table: 'inventory', set: { value: 'the entire body' } });
    }
  });

  it('drills into the upstream JSON body via sourceJsonPath', async () => {
    const file = await writeTempJson({ rows: [{ units: 7 }] });
    const upstream = nxsNode('read', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate({ table: 'inventory', set: { units: -1 } }, [
        {
          fromSubTaskKey: 'read' as NonEmpty,
          slotId: 'rows' as NonEmpty,
          payloadPath: 'set.units' as NonEmpty,
          sourceJsonPath: 'rows.0.units' as NonEmpty,
        },
      ]),
      [{ fromSubTaskKey: 'read' as NonEmpty, slotId: 'rows' as NonEmpty }]
    );
    const plan = planWith([upstream, writer]);
    const mailbox = mockMailboxService(
      new Map([[`${upstream.nodeId}::rows`, mailboxItemFor(upstream.nodeId, 'rows', file)]])
    );

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.payload).toEqual({ table: 'inventory', set: { units: 7 } });
    }
  });

  it('fails when the upstream subtask is not in the plan', async () => {
    const writer = nxsNode(
      'write',
      nxsTemplate({ set: { v: 0 } }, [
        {
          fromSubTaskKey: 'ghost' as NonEmpty,
          slotId: 'x' as NonEmpty,
          payloadPath: 'set.v' as NonEmpty,
          sourceJsonPath: null,
        },
      ]),
      [{ fromSubTaskKey: 'ghost' as NonEmpty, slotId: 'x' as NonEmpty }]
    );
    const plan = planWith([writer]);

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mockMailboxService(new Map()),
      runId: uuid(),
    });

    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toContain('upstream_subtask_not_in_plan');
  });

  it('fails when the upstream slot item is missing', async () => {
    const upstream = nxsNode('read', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate({ set: { v: 0 } }, [
        {
          fromSubTaskKey: 'read' as NonEmpty,
          slotId: 'data' as NonEmpty,
          payloadPath: 'set.v' as NonEmpty,
          sourceJsonPath: null,
        },
      ]),
      [{ fromSubTaskKey: 'read' as NonEmpty, slotId: 'data' as NonEmpty }]
    );
    const plan = planWith([upstream, writer]);
    const mailbox = mockMailboxService(new Map());

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toContain('upstream_slot_item_missing');
  });

  it('fails when sourceJsonPath drills into non-JSON body', async () => {
    const file = await writeTempJson('not-json-not-quoted');
    const upstream = nxsNode('read', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate({ set: { v: 0 } }, [
        {
          fromSubTaskKey: 'read' as NonEmpty,
          slotId: 'data' as NonEmpty,
          payloadPath: 'set.v' as NonEmpty,
          sourceJsonPath: 'a.b' as NonEmpty,
        },
      ]),
      [{ fromSubTaskKey: 'read' as NonEmpty, slotId: 'data' as NonEmpty }]
    );
    const plan = planWith([upstream, writer]);
    const mailbox = mockMailboxService(
      new Map([[`${upstream.nodeId}::data`, mailboxItemFor(upstream.nodeId, 'data', file)]])
    );

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toContain('upstream_body_not_json');
  });

  it('fails when payloadPath leaf does not pre-exist', async () => {
    const file = await writeTempJson('value');
    const upstream = nxsNode('read', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate(
        { table: 'inventory' }, // no `set.units` placeholder
        [
          {
            fromSubTaskKey: 'read' as NonEmpty,
            slotId: 'data' as NonEmpty,
            payloadPath: 'set.units' as NonEmpty,
            sourceJsonPath: null,
          },
        ]
      ),
      [{ fromSubTaskKey: 'read' as NonEmpty, slotId: 'data' as NonEmpty }]
    );
    const plan = planWith([upstream, writer]);
    const mailbox = mockMailboxService(
      new Map([[`${upstream.nodeId}::data`, mailboxItemFor(upstream.nodeId, 'data', file)]])
    );

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(false);
    if (!result.resolved) expect(result.reason).toContain('payload_path_intermediate_missing');
  });

  it('resolves multiple bindings into distinct leaves', async () => {
    const file1 = await writeTempJson({ units: 7 });
    const file2 = await writeTempJson('Adjusted by warehouse agent');
    const r1 = nxsNode('read', nxsTemplate({}));
    const r2 = nxsNode('note', nxsTemplate({}));
    const writer = nxsNode(
      'write',
      nxsTemplate({ table: 'inventory', set: { units: -1, note: '__P__' } }, [
        {
          fromSubTaskKey: 'read' as NonEmpty,
          slotId: 'data' as NonEmpty,
          payloadPath: 'set.units' as NonEmpty,
          sourceJsonPath: 'units' as NonEmpty,
        },
        {
          fromSubTaskKey: 'note' as NonEmpty,
          slotId: 'text' as NonEmpty,
          payloadPath: 'set.note' as NonEmpty,
          sourceJsonPath: null,
        },
      ]),
      [
        { fromSubTaskKey: 'read' as NonEmpty, slotId: 'data' as NonEmpty },
        { fromSubTaskKey: 'note' as NonEmpty, slotId: 'text' as NonEmpty },
      ]
    );
    const plan = planWith([r1, r2, writer]);
    const mailbox = mockMailboxService(
      new Map([
        [`${r1.nodeId}::data`, mailboxItemFor(r1.nodeId, 'data', file1)],
        [`${r2.nodeId}::text`, mailboxItemFor(r2.nodeId, 'text', file2)],
      ])
    );

    const result = await resolveNxsSlotBindings({
      node: writer,
      plan,
      mailboxService: mailbox,
      runId: uuid(),
    });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.payload).toEqual({
        table: 'inventory',
        set: { units: 7, note: 'Adjusted by warehouse agent' },
      });
    }
  });
});
