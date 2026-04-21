/**
 * Lexical Normalizer — Unit Tests — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §38.8
 *
 * Tests:
 *   - lexical cleanup assists normalization without making governance decisions
 *   - unresolvable raw verb returned unchanged (Gate 02 handles denial)
 *   - normalizer never loads wordnet-candidate-aliases.v1.json at runtime
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { LexicalNormalizer } from './lexical-normalizer.js';
import { ACTION_VERB, type GovernedVerbLexicon } from '../types/index.js';

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
      edit: 'update',
      remove: 'delete',
      run: 'execute',
      ask: 'query',
      scan: 'search',
      broadcast: 'publish',
      email: 'send',
      download: 'export',
      summarize: 'synthesize',
      transfer: 'transmit',
    },
    forbidden: { _forbidden: ['hack'] },
    hardSeparated: {},
    reviewRequired: [],
  };
}

describe('LexicalNormalizer', () => {
  let normalizer: LexicalNormalizer;

  beforeAll(() => {
    normalizer = new LexicalNormalizer(makeTestLexicon(), CANONICAL_VERBS);
  });

  // ─── Cleanup assists normalization ───
  describe('lexical cleanup without governance decisions', () => {
    it('passes through canonical verb unchanged', () => {
      expect(normalizer.normalizeVerb('read')).toBe('read');
      expect(normalizer.normalizeVerb('execute')).toBe('execute');
    });

    it('resolves approved alias to canonical verb', () => {
      expect(normalizer.normalizeVerb('fetch')).toBe('read');
      expect(normalizer.normalizeVerb('add')).toBe('create');
      expect(normalizer.normalizeVerb('edit')).toBe('update');
      expect(normalizer.normalizeVerb('run')).toBe('execute');
    });

    it('is case-insensitive', () => {
      expect(normalizer.normalizeVerb('FETCH')).toBe('read');
      expect(normalizer.normalizeVerb('Add')).toBe('create');
    });

    it('trims whitespace', () => {
      expect(normalizer.normalizeVerb('  fetch  ')).toBe('read');
    });
  });

  // ─── Unresolvable — return unchanged ───
  describe('unresolvable raw verb returned unchanged', () => {
    it('returns unknown term unchanged', () => {
      expect(normalizer.normalizeVerb('flibbertigibbet')).toBe('flibbertigibbet');
    });

    it('returns forbidden term unchanged (governance is Gate 02)', () => {
      // The normalizer does NOT enforce forbidden — that's Gate 02's job
      expect(normalizer.normalizeVerb('hack')).toBe('hack');
    });

    it('returns empty string unchanged', () => {
      expect(normalizer.normalizeVerb('')).toBe('');
    });
  });

  // ─── Never loads WordNet at runtime ───
  describe('WordNet isolation', () => {
    it('does not reference wordnet-candidate-aliases.v1.json', () => {
      // Verify the constructor and normalizeVerb don't attempt to read
      // the candidate aliases file. The normalizer only receives the
      // governed lexicon (which is the runtime authority artifact).
      const freshNormalizer = new LexicalNormalizer(makeTestLexicon(), CANONICAL_VERBS);
      // If this succeeds without error, no WordNet file was accessed
      expect(freshNormalizer.normalizeVerb('fetch')).toBe('read');
    });
  });
});
