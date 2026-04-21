/**
 * Lexical Verb Resolver — Unit Tests — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §38.8
 *
 * Tests:
 *   - approved alias maps deterministically to canonical verb
 *   - hard separation: 'query' does not collapse to 'execute'
 *   - hard separation: 'send' does not collapse to 'publish'
 *   - hard separation: 'search' does not collapse to 'read'
 *   - hard separation: 'publish' does not collapse to 'transmit'
 *   - ambiguous alias emits null (unresolved) — never a guess
 *   - unknown raw term emits null (unresolved)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { LexicalVerbResolver } from './lexical-verb-resolver.js';
import { ACTION_VERB, type GovernedVerbLexicon } from '../types/index.js';

// ─── Test fixture: mirrors the governed lexical fixture structure ───
function makeTestLexicon(): GovernedVerbLexicon {
  return {
    lexiconVersion: 'v1',
    canonicalVerbTaxonomyVersion: 'v1.0.0',
    wordnetSourceVersion: '3.0',
    generatedAt: '2026-04-21T00:00:00.000Z',
    approved: {
      fetch: 'read',
      retrieve: 'read',
      get: 'read',
      add: 'create',
      insert: 'create',
      edit: 'update',
      modify: 'update',
      remove: 'delete',
      destroy: 'delete',
      run: 'execute',
      invoke: 'execute',
      record: 'write',
      save: 'write',
      ask: 'query',
      inquire: 'query',
      scan: 'search',
      browse: 'search',
      broadcast: 'publish',
      release: 'publish',
      download: 'export',
      dump: 'export',
      email: 'send',
      notify: 'send',
      dispatch: 'send',
      summarize: 'synthesize',
      combine: 'synthesize',
      transfer: 'transmit',
      relay: 'transmit',
    },
    forbidden: {
      _forbidden: ['hack', 'exploit', 'bypass'],
    },
    hardSeparated: {
      read: ['search'],
      search: ['read'],
      execute: ['query'],
      query: ['execute'],
      publish: ['send', 'transmit'],
      send: ['publish'],
      transmit: ['publish'],
    },
    reviewRequired: ['probe', 'access'],
  };
}

describe('LexicalVerbResolver', () => {
  let resolver: LexicalVerbResolver;

  beforeAll(() => {
    resolver = new LexicalVerbResolver(makeTestLexicon());
  });

  // ─── Step 1: Exact canonical verb match ───
  describe('Step 1 — exact canonical verb match', () => {
    for (const verb of Object.values(ACTION_VERB)) {
      it(`resolves canonical verb '${verb}' to itself`, () => {
        expect(resolver.resolve(verb)).toBe(verb);
      });
    }

    it('is case-insensitive', () => {
      expect(resolver.resolve('READ')).toBe('read');
      expect(resolver.resolve('Create')).toBe('create');
    });
  });

  // ─── Step 2: Approved alias match ───
  describe('Step 2 — approved alias deterministic mapping', () => {
    it('maps "fetch" to "read"', () => {
      expect(resolver.resolve('fetch')).toBe('read');
    });

    it('maps "add" to "create"', () => {
      expect(resolver.resolve('add')).toBe('create');
    });

    it('maps "edit" to "update"', () => {
      expect(resolver.resolve('edit')).toBe('update');
    });

    it('maps "remove" to "delete"', () => {
      expect(resolver.resolve('remove')).toBe('delete');
    });

    it('maps "run" to "execute"', () => {
      expect(resolver.resolve('run')).toBe('execute');
    });

    it('maps "ask" to "query"', () => {
      expect(resolver.resolve('ask')).toBe('query');
    });

    it('maps "scan" to "search"', () => {
      expect(resolver.resolve('scan')).toBe('search');
    });

    it('maps "broadcast" to "publish"', () => {
      expect(resolver.resolve('broadcast')).toBe('publish');
    });

    it('maps "email" to "send"', () => {
      expect(resolver.resolve('email')).toBe('send');
    });

    it('maps "transfer" to "transmit"', () => {
      expect(resolver.resolve('transfer')).toBe('transmit');
    });

    it('is case-insensitive for aliases', () => {
      expect(resolver.resolve('FETCH')).toBe('read');
      expect(resolver.resolve('Invoke')).toBe('execute');
    });
  });

  // ─── Hard separation: governance-significant distinctions ───
  describe('Hard separation — governance-significant distinctions (§13.3.1)', () => {
    it('search does NOT collapse to read', () => {
      // "search" is a canonical verb resolved by step 1
      expect(resolver.resolve('search')).toBe('search');
      // If "search" were NOT canonical, it should be blocked
      expect(resolver.isBlocked('search')).toBe(true); // 'search' is in hardSeparated set — but resolve() handles it at step 1 before isBlocked is reached
    });

    it('query does NOT collapse to execute', () => {
      expect(resolver.resolve('query')).toBe('query');
    });

    it('send does NOT collapse to publish', () => {
      expect(resolver.resolve('send')).toBe('send');
    });

    it('publish does NOT collapse to transmit', () => {
      expect(resolver.resolve('publish')).toBe('publish');
    });

    it('blocks terms in hard-separated set', () => {
      // Hard-separated set for 'read' contains 'search' — but 'search' is
      // canonical and resolves at step 1. The isBlocked check is for non-canonical terms.
      // Let's test with a hypothetical: if the hardSeparated set contained a non-canonical term
      const customLexicon = makeTestLexicon();
      customLexicon.hardSeparated = { read: ['lookup_search'] };
      const customResolver = new LexicalVerbResolver(customLexicon);
      expect(customResolver.isBlocked('lookup_search')).toBe(true);
    });
  });

  // ─── Forbidden terms ───
  describe('Forbidden terms', () => {
    it('blocks "hack"', () => {
      expect(resolver.resolve('hack')).toBeNull();
      expect(resolver.isBlocked('hack')).toBe(true);
    });

    it('blocks "exploit"', () => {
      expect(resolver.resolve('exploit')).toBeNull();
      expect(resolver.isBlocked('exploit')).toBe(true);
    });

    it('blocks "bypass"', () => {
      expect(resolver.resolve('bypass')).toBeNull();
      expect(resolver.isBlocked('bypass')).toBe(true);
    });
  });

  // ─── Ambiguous and unknown terms ───
  describe('Ambiguous / unknown — never guess', () => {
    it('emits null for unknown raw term', () => {
      expect(resolver.resolve('flibbertigibbet')).toBeNull();
    });

    it('emits null for ambiguous term not in approved set', () => {
      expect(resolver.resolve('probe')).toBeNull();
    });

    it('emits null for empty string', () => {
      expect(resolver.resolve('')).toBeNull();
    });

    it('emits null for whitespace-only string', () => {
      expect(resolver.resolve('   ')).toBeNull();
    });
  });

  // ─── resolveApprovedOnly ───
  describe('resolveApprovedOnly — steps 1+2 only', () => {
    it('resolves canonical verb', () => {
      expect(resolver.resolveApprovedOnly('read')).toBe('read');
    });

    it('resolves approved alias', () => {
      expect(resolver.resolveApprovedOnly('fetch')).toBe('read');
    });

    it('returns null for unknown term', () => {
      expect(resolver.resolveApprovedOnly('flibbertigibbet')).toBeNull();
    });

    it('returns null for forbidden term (step 4 not applied)', () => {
      expect(resolver.resolveApprovedOnly('hack')).toBeNull();
    });
  });
});
