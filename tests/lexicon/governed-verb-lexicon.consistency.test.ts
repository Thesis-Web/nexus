/**
 * Governed Verb Lexicon — Consistency Tests — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §38.8
 *
 * Tests (against the committed governed-verb-lexicon.v1.json fixture):
 *   - approved, forbidden, hard-separated, and review-required sets are internally consistent
 *   - no approved alias maps to more than one canonical verb
 *   - no hard-separated term appears in approved set
 *   - all canonical verbs in fixture exist in ACTION_VERB constant set
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ACTION_VERB, type GovernedVerbLexicon } from '../../packages/contracts/src/index.js';

const CANONICAL_VERBS = new Set<string>(Object.values(ACTION_VERB));

// ─── Load the real committed fixture ───
function loadFixture(): GovernedVerbLexicon {
  const fixturePath = resolve(process.cwd(), 'fixtures/lexicon/governed-verb-lexicon.v1.json');
  const raw = readFileSync(fixturePath, 'utf-8');
  return JSON.parse(raw) as GovernedVerbLexicon;
}

describe('Governed Verb Lexicon — Consistency', () => {
  let lexicon: GovernedVerbLexicon;

  beforeAll(() => {
    lexicon = loadFixture();
  });

  // ─── §37.14 — Fixture shape ───
  it('fixture has all required keys', () => {
    expect(lexicon.lexiconVersion).toBeDefined();
    expect(lexicon.canonicalVerbTaxonomyVersion).toBeDefined();
    expect(lexicon.wordnetSourceVersion).toBeDefined();
    expect(lexicon.generatedAt).toBeDefined();
    expect(lexicon.approved).toBeDefined();
    expect(typeof lexicon.approved).toBe('object');
    expect(lexicon.forbidden).toBeDefined();
    expect(typeof lexicon.forbidden).toBe('object');
    expect(lexicon.hardSeparated).toBeDefined();
    expect(typeof lexicon.hardSeparated).toBe('object');
    expect(Array.isArray(lexicon.reviewRequired)).toBe(true);
  });

  // ─── §37.15 — No approved alias maps to more than one canonical verb ───
  it('no approved alias maps to more than one canonical verb', () => {
    const aliasToVerb = new Map<string, string>();
    const duplicates: string[] = [];

    for (const [rawTerm, canonicalVerb] of Object.entries(lexicon.approved)) {
      const existing = aliasToVerb.get(rawTerm);
      if (existing !== undefined && existing !== canonicalVerb) {
        duplicates.push(`'${rawTerm}' → '${existing}' AND '${canonicalVerb}'`);
      }
      aliasToVerb.set(rawTerm, canonicalVerb);
    }

    expect(duplicates).toEqual([]);
  });

  // ─── §37.16 — No hard-separated term appears in approved set ───
  it('no hard-separated term appears in approved set', () => {
    const allHardSep = new Set<string>();
    for (const terms of Object.values(lexicon.hardSeparated)) {
      for (const term of terms) {
        allHardSep.add(term);
      }
    }

    const overlaps: string[] = [];
    for (const term of allHardSep) {
      if (term in lexicon.approved) {
        overlaps.push(term);
      }
    }

    expect(overlaps).toEqual([]);
  });

  // ─── §37.17 — All canonical verbs in fixture exist in ACTION_VERB set ───
  it('all approved target verbs exist in ACTION_VERB set', () => {
    const unknownVerbs: string[] = [];
    for (const verb of new Set(Object.values(lexicon.approved))) {
      if (!CANONICAL_VERBS.has(verb)) {
        unknownVerbs.push(verb);
      }
    }
    expect(unknownVerbs).toEqual([]);
  });

  it('all hardSeparated keys are canonical verbs', () => {
    const unknownVerbs: string[] = [];
    for (const verb of Object.keys(lexicon.hardSeparated)) {
      if (!CANONICAL_VERBS.has(verb)) {
        unknownVerbs.push(verb);
      }
    }
    expect(unknownVerbs).toEqual([]);
  });

  // ─── Internal consistency ───
  it('no term is in both approved and forbidden', () => {
    const allForbidden = new Set<string>();
    for (const terms of Object.values(lexicon.forbidden)) {
      for (const term of terms) {
        allForbidden.add(term);
      }
    }

    const overlaps: string[] = [];
    for (const term of allForbidden) {
      if (term in lexicon.approved) {
        overlaps.push(term);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('no review-required term is in approved set', () => {
    const overlaps: string[] = [];
    for (const term of lexicon.reviewRequired) {
      if (term in lexicon.approved) {
        overlaps.push(term);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('lexiconVersion matches expected format', () => {
    expect(lexicon.lexiconVersion).toBe('v1');
  });

  it('canonicalVerbTaxonomyVersion matches expected format', () => {
    expect(lexicon.canonicalVerbTaxonomyVersion).toBe('v1.0.0');
  });
});
