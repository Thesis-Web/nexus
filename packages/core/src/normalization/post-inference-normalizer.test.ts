/**
 * PostInferenceNormalizerImpl — Unit Tests
 *
 * Spec: §28.1 NVG → NXS boundary normalizer.
 * CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §6.
 *
 * Pure function tests — no jsdom, no mocks beyond LexicalNormalizer
 * which is itself pure. Asserts the contract:
 *   - normalize() returns a SINGLE AgentAction per call.
 *   - Governance fields (resolvedVerb / resolvedCapability /
 *     resolvedTarget / resolvedDataClasses / resolvedRiskTier) are
 *     ALL null. Gate 02 is the authority.
 *   - delegationSequence is 0 (pipeline overwrites).
 *   - Tool-name parsing splits on the first underscore.
 *   - NormalizerContext fields flow through verbatim.
 *   - Lexical cleanup happens BEFORE normalization (so a known
 *     alias like "fetch" → "read" passes through cleaned).
 *   - Bad input throws — the route MUST hand a valid object in.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PostInferenceNormalizerImpl } from './post-inference-normalizer.js';
import { LexicalNormalizer } from './lexical-normalizer.js';
import { ACTION_VERB, type GovernedVerbLexicon } from '../types/index.js';
import type { NormalizerContext, Uuid, NonEmpty } from '@nexus/contracts';

const CANONICAL_VERBS = Object.values(ACTION_VERB);

function makeTestLexicon(): GovernedVerbLexicon {
  return {
    lexiconVersion: 'v1',
    canonicalVerbTaxonomyVersion: 'v1.0.0',
    wordnetSourceVersion: '3.0',
    generatedAt: '2026-04-21T00:00:00.000Z',
    approved: {
      fetch: 'read',
      retrieve: 'read',
      add: 'create',
    },
    forbidden: { _forbidden: ['hack'] },
    hardSeparated: {},
    reviewRequired: [],
  };
}

const CTX: NormalizerContext = {
  runId: '11111111-2222-4333-8444-555555555555' as Uuid,
  actorId: '22222222-3333-4444-8555-666666666666' as Uuid,
  principalId: '33333333-4444-4555-8666-777777777777' as Uuid,
  sessionId: '44444444-5555-4666-8777-888888888888' as Uuid,
  delegationId: '55555555-6666-4777-8888-999999999999' as Uuid,
  protocol: 'post-inference-tool-call' as NonEmpty,
};

describe('PostInferenceNormalizerImpl', () => {
  let normalizer: PostInferenceNormalizerImpl;
  beforeAll(() => {
    const lexical = new LexicalNormalizer(makeTestLexicon(), CANONICAL_VERBS);
    normalizer = new PostInferenceNormalizerImpl(lexical);
  });

  it('normalizes a tool call into a valid AgentAction', () => {
    const tc = {
      toolName: 'read_database',
      arguments: { table: 'customers' },
      providerCallId: 'call_42',
    };
    const action = normalizer.normalize(tc, CTX);

    expect(action.tool).toBe('read_database');
    expect(action.rawVerb).toBe('read');
    expect(action.rawTarget).toBe('database');
    // rawPayload preserves arguments + providerCallId so downstream
    // can correlate the tool result back to the originating call.
    expect(action.rawPayload).toEqual({
      arguments: { table: 'customers' },
      providerCallId: 'call_42',
    });
  });

  it('leaves all governance fields null — Gate 02 is the authority', () => {
    const tc = { toolName: 'read_db', arguments: {}, providerCallId: null };
    const action = normalizer.normalize(tc, CTX);

    expect(action.resolvedVerb).toBeNull();
    expect(action.resolvedCapability).toBeNull();
    expect(action.resolvedTarget).toBeNull();
    expect(action.resolvedDataClasses).toEqual([]);
    expect(action.resolvedRiskTier).toBeNull();
  });

  it('threads NormalizerContext fields through unchanged', () => {
    const action = normalizer.normalize(
      { toolName: 'lookup', arguments: {}, providerCallId: null },
      CTX
    );
    expect(action.runId).toBe(CTX.runId);
    expect(action.actorId).toBe(CTX.actorId);
    expect(action.principalId).toBe(CTX.principalId);
    expect(action.sessionId).toBe(CTX.sessionId);
    expect(action.delegationId).toBe(CTX.delegationId);
    expect(action.protocol).toBe(CTX.protocol);
  });

  it('sets delegationSequence to 0 — pipeline assigns the real sequence', () => {
    const action = normalizer.normalize(
      { toolName: 'read_users', arguments: {}, providerCallId: null },
      CTX
    );
    expect(action.delegationSequence).toBe(0);
  });

  it('handles tool names without underscore (verb == target)', () => {
    const action = normalizer.normalize(
      { toolName: 'search', arguments: {}, providerCallId: null },
      CTX
    );
    expect(action.tool).toBe('search');
    expect(action.rawVerb).toBe('search');
    expect(action.rawTarget).toBe('search');
  });

  it('applies lexical cleanup to the verb (alias → canonical)', () => {
    // "fetch" is an approved alias for "read" in the test lexicon.
    const action = normalizer.normalize(
      { toolName: 'fetch_records', arguments: {}, providerCallId: null },
      CTX
    );
    expect(action.rawVerb).toBe('read');
    // Tool name is preserved verbatim — the lexical pass only touches
    // the rawVerb so Gate 02 sees the cleaned form first.
    expect(action.tool).toBe('fetch_records');
    expect(action.rawTarget).toBe('records');
  });

  it('returns the raw verb unchanged when the lexicon cannot resolve it', () => {
    // "yeet" is not a canonical verb and not in the alias map.
    const action = normalizer.normalize(
      { toolName: 'yeet_things', arguments: {}, providerCallId: null },
      CTX
    );
    expect(action.rawVerb).toBe('yeet');
    expect(action.tool).toBe('yeet_things');
    // Gate 02 will deny via UNRESOLVABLE_VERB; the normalizer never decides.
  });

  it('preserves the providerCallId in rawPayload', () => {
    const action = normalizer.normalize(
      { toolName: 'read_db', arguments: { x: 1 }, providerCallId: 'toolu_xyz' },
      CTX
    );
    const payload = action.rawPayload as Record<string, unknown>;
    expect(payload['providerCallId']).toBe('toolu_xyz');
    expect(payload['arguments']).toEqual({ x: 1 });
  });

  it('throws when modelOutput is not an object (callers MUST pre-extract)', () => {
    expect(() => normalizer.normalize('raw_string' as unknown, CTX)).toThrow(
      /ExtractedToolCall object/
    );
    expect(() => normalizer.normalize(null as unknown, CTX)).toThrow(/ExtractedToolCall object/);
  });

  it('throws when toolName is missing or empty', () => {
    expect(() => normalizer.normalize({ arguments: {}, providerCallId: null }, CTX)).toThrow(
      /toolName/
    );
    expect(() =>
      normalizer.normalize({ toolName: '', arguments: {}, providerCallId: null }, CTX)
    ).toThrow(/toolName/);
  });
});
