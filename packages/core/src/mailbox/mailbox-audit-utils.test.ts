/**
 * Unit tests for mailbox-audit-utils — allowed importer per spec
 * §3.1.1.2 (this file is one of the explicitly-allowed test consumers
 * of decodeActorIdFromMailboxId).
 */
import { describe, it, expect } from 'vitest';
import type { Uuid, NonEmpty } from '@nexus/contracts';
import { decodeActorIdFromMailboxId } from './mailbox-audit-utils.js';
import { encodeMailboxIdV1 } from './mailbox-id-format.js';

const RUN = '11111111-1111-4111-8111-111111111111' as Uuid;
const ACTOR = '22222222-2222-4222-8222-222222222222' as Uuid;

describe('decodeActorIdFromMailboxId', () => {
  it('round-trips encodeMailboxIdV1', () => {
    const encoded = encodeMailboxIdV1(RUN, ACTOR);
    const decoded = decodeActorIdFromMailboxId(encoded);
    expect(decoded).toBe(ACTOR);
  });

  it('returns null when the prefix is not the V1 prefix', () => {
    const bogus = 'mbx-v2-run-x-actor-y' as NonEmpty;
    expect(decodeActorIdFromMailboxId(bogus)).toBeNull();
  });

  it('returns null when the actor infix is missing', () => {
    const truncated = `mbx-v1-run-${RUN}` as NonEmpty;
    expect(decodeActorIdFromMailboxId(truncated)).toBeNull();
  });

  it('returns null when the actor part is empty', () => {
    const empty = `mbx-v1-run-${RUN}-actor-` as NonEmpty;
    expect(decodeActorIdFromMailboxId(empty)).toBeNull();
  });

  it('returns null when the infix appears more than once', () => {
    // Two -actor- separators — ambiguous, refuse.
    const doubled = `mbx-v1-run-${RUN}-actor-${ACTOR}-actor-extra` as NonEmpty;
    expect(decodeActorIdFromMailboxId(doubled)).toBeNull();
  });

  it('returns null for an unrelated string', () => {
    expect(decodeActorIdFromMailboxId('hello' as NonEmpty)).toBeNull();
  });

  it('returns null for the empty-ish case (prefix only)', () => {
    expect(decodeActorIdFromMailboxId('mbx-v1-run-' as NonEmpty)).toBeNull();
  });
});
