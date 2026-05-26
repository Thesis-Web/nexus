/**
 * verifyMailboxItems — unit tests for F4.12 §3.1 per-item verification.
 *
 * Covers the four cases the pass-through paths (single + bundle) need:
 *   - Happy path: all items pass digest + provenance checks; resolved
 *     bytes returned in order.
 *   - digest_mismatch: bytes on disk don't hash to item.resultDigest.
 *   - unknown_provenance: item.provenance === 'unknown' short-circuits
 *     before the digest check.
 *   - resolver_unavailable: no PayloadResolver accepts item.resultRef.
 *
 * Plus: short-circuit ordering (provenance before resolver lookup);
 * empty-list happy-path (vacuously ok).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  DataClass,
  IsoTimestamp,
  MailboxItem,
  NonEmpty,
  OctLevel,
  PayloadResolver,
  ProvenanceSource,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { verifyMailboxItems } from './verify-mailbox-items.js';

function sha256Hex(bytes: Uint8Array | string): Sha256Hex {
  const buf = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return createHash('sha256').update(buf).digest('hex') as Sha256Hex;
}

function makeItem(opts: {
  id: string;
  mailboxId: string;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  provenance?: ProvenanceSource;
}): MailboxItem {
  return {
    mailboxItemId: opts.id as Uuid,
    mailboxId: opts.mailboxId as NonEmpty,
    runId: '11111111-1111-4111-8111-111111111111' as Uuid,
    taskId: '22222222-2222-4222-8222-222222222222' as Uuid,
    agentId: '33333333-3333-4333-8333-333333333333' as Uuid,
    slotId: 'agent_output' as NonEmpty,
    sourceType: 'nxs_execution_result',
    resultRef: opts.resultRef,
    resultDigest: opts.resultDigest,
    resultClassifications: [] as DataClass[],
    provenance: opts.provenance ?? 'nxs_connector_result',
    octLevel: 'OCT-OPEN' as OctLevel,
    createdAt: '2026-01-01T00:00:00.000Z' as IsoTimestamp,
    expiresAt: null,
    evidenceRecordId: null,
    routingTrailRecordId: null,
    runLedgerEventId: null,
    redactionState: 'not_required',
    mailboxStatus: 'eligible',
    compileEligible: true,
    consumedAt: null,
    blockedReason: null,
    // finalOutcome carried for parity with the real shape; unused here.
    finalOutcome: FINAL_OUTCOME.EXECUTED,
  } as unknown as MailboxItem;
}

/** PayloadResolver backed by an in-memory Map<resultRef, bytes>. */
function makeResolver(byRef: Map<string, Uint8Array>): PayloadResolver {
  return {
    resolverId: 'inmem' as NonEmpty,
    resolverVersion: '1' as NonEmpty,
    canResolve: ref => byRef.has(ref as string),
    resolveBytes: async ref => byRef.get(ref as string) ?? new Uint8Array(),
  };
}

describe('verifyMailboxItems — F4.12 §3.1 pass-through verification', () => {
  it('happy path: all items verify; resolvedItems returned in input order', async () => {
    const a = new TextEncoder().encode('actor A body');
    const b = new TextEncoder().encode('actor B body');
    const c = new TextEncoder().encode('actor C body');
    const resolver = makeResolver(
      new Map([
        ['ref://a', a],
        ['ref://b', b],
        ['ref://c', c],
      ])
    );
    const items = [
      makeItem({
        id: 'item-a',
        mailboxId: 'mbx-a',
        resultRef: 'ref://a' as NonEmpty,
        resultDigest: sha256Hex(a),
      }),
      makeItem({
        id: 'item-b',
        mailboxId: 'mbx-b',
        resultRef: 'ref://b' as NonEmpty,
        resultDigest: sha256Hex(b),
      }),
      makeItem({
        id: 'item-c',
        mailboxId: 'mbx-c',
        resultRef: 'ref://c' as NonEmpty,
        resultDigest: sha256Hex(c),
      }),
    ];
    const result = await verifyMailboxItems(items, [resolver]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedItems).toHaveLength(3);
    expect(result.resolvedItems[0]!.item.mailboxItemId).toBe('item-a');
    expect(result.resolvedItems[2]!.item.mailboxItemId).toBe('item-c');
    expect(result.resolvedItems[0]!.bytes).toEqual(a);
  });

  it('digest_mismatch: bytes on disk do not hash to item.resultDigest', async () => {
    const real = new TextEncoder().encode('original body');
    const tampered = new TextEncoder().encode('TAMPERED bytes — different');
    const resolver = makeResolver(new Map([['ref://t', tampered]]));
    const items = [
      makeItem({
        id: 'item-t',
        mailboxId: 'mbx-t',
        resultRef: 'ref://t' as NonEmpty,
        // resultDigest claims the ORIGINAL bytes; resolver returns tampered.
        resultDigest: sha256Hex(real),
      }),
    ];
    const result = await verifyMailboxItems(items, [resolver]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('digest_mismatch');
    expect(result.mailboxItemId).toBe('item-t');
    expect(result.sourceMailboxId).toBe('mbx-t');
    expect(result.detail).toContain('sha256 mismatch');
  });

  it('unknown_provenance: short-circuits before digest verify', async () => {
    // The resolver is empty — if the function attempted to resolve, it would
    // return 'resolver_unavailable'. Asserting reason='unknown_provenance'
    // proves the provenance check fires FIRST (cheapest first per spec).
    const resolver = makeResolver(new Map());
    const items = [
      makeItem({
        id: 'item-u',
        mailboxId: 'mbx-u',
        resultRef: 'ref://u' as NonEmpty,
        resultDigest: sha256Hex(''),
        provenance: 'unknown',
      }),
    ];
    const result = await verifyMailboxItems(items, [resolver]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_provenance');
    expect(result.mailboxItemId).toBe('item-u');
  });

  it('resolver_unavailable: no resolver accepts the resultRef', async () => {
    const resolver = makeResolver(new Map([['ref://other', new Uint8Array()]]));
    const items = [
      makeItem({
        id: 'item-x',
        mailboxId: 'mbx-x',
        resultRef: 'ref://missing' as NonEmpty,
        resultDigest: sha256Hex(''),
      }),
    ];
    const result = await verifyMailboxItems(items, [resolver]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('resolver_unavailable');
    expect(result.detail).toContain('no payload resolver accepted');
  });

  it('empty input list: vacuously ok with empty resolvedItems', async () => {
    const result = await verifyMailboxItems([], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedItems).toHaveLength(0);
  });

  it('short-circuits on first failure (later items unread)', async () => {
    // Item 1 fails digest; item 2 has provenance=unknown. The function
    // must short-circuit on item 1's failure WITHOUT attempting item 2 —
    // otherwise the "first failure wins" contract (compile cannot
    // partially-quarantine on the pass-through path) is broken.
    const real = new TextEncoder().encode('original');
    const tampered = new TextEncoder().encode('tampered');
    const resolver = makeResolver(new Map([['ref://1', tampered]]));
    const items = [
      makeItem({
        id: 'item-1',
        mailboxId: 'mbx-1',
        resultRef: 'ref://1' as NonEmpty,
        resultDigest: sha256Hex(real),
      }),
      makeItem({
        id: 'item-2',
        mailboxId: 'mbx-2',
        resultRef: 'ref://2' as NonEmpty,
        resultDigest: sha256Hex(''),
        provenance: 'unknown',
      }),
    ];
    const result = await verifyMailboxItems(items, [resolver]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // First failure is item-1's digest mismatch — NOT item-2's
    // unknown_provenance. Proves we exited at item-1.
    expect(result.reason).toBe('digest_mismatch');
    expect(result.mailboxItemId).toBe('item-1');
  });
});
