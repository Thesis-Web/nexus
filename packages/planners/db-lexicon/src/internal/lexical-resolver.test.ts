// packages/planners/db-lexicon/src/internal/lexical-resolver.test.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.1 lexical-resolver tests.

import { describe, expect, it } from 'vitest';
import { resolveLexical } from './lexical-resolver.js';
import type { LexiconTablesV1 } from './types.js';
import type { NonEmpty } from '@nexus/contracts';

/**
 * Build a minimal in-memory LexiconTablesV1 for unit tests. Avoids
 * disk I/O + signature verification by stubbing the tables directly.
 */
function buildTestTables(overrides?: Partial<LexiconTablesV1>): LexiconTablesV1 {
  const lexicalTerms = overrides?.lexicalTerms ?? [
    { rawTerm: 'pull', canonicalTerm: 'read', phraseClass: 'verb', source: 'test' as NonEmpty },
    {
      rawTerm: 'adjust',
      canonicalTerm: 'update',
      phraseClass: 'verb',
      source: 'test' as NonEmpty,
    },
    {
      rawTerm: 'warehouse inventory',
      canonicalTerm: 'inventory_row',
      phraseClass: 'noun',
      source: 'test' as NonEmpty,
    },
    {
      rawTerm: 'from receiving today',
      canonicalTerm: 'receiving_delta',
      phraseClass: 'business_phrase',
      source: 'test' as NonEmpty,
    },
  ];

  const aliasRules = overrides?.aliasRules ?? [
    {
      rawTerm: 'drop everything',
      canonicalTerm: 'delete',
      status: 'blocked',
      reason: 'forbidden' as NonEmpty,
    },
  ];

  // Build indexes
  const termByRaw = new Map<string, typeof lexicalTerms>();
  for (const t of lexicalTerms) {
    const key = t.rawTerm.toLowerCase();
    let list = termByRaw.get(key);
    if (!list) {
      list = [];
      termByRaw.set(key, list as typeof lexicalTerms);
    }
    (list as Array<(typeof lexicalTerms)[number]>).push(t);
  }
  const aliasByRaw = new Map<string, (typeof aliasRules)[number]>();
  for (const r of aliasRules) {
    aliasByRaw.set(r.rawTerm.toLowerCase(), r);
  }

  return {
    lexicalTerms,
    aliasRules,
    taskIntents: [],
    taskCapabilities: [],
    targetCatalog: [],
    workflowTemplates: [],
    workflowNodes: [],
    workflowEdges: [],
    termByRaw,
    aliasByRaw,
    intentById: new Map(),
    capabilitiesByIntent: new Map(),
    targetByBusinessTerm: new Map(),
    templateById: new Map(),
    templatesByIntent: new Map(),
    nodesByTemplate: new Map(),
    edgesByTemplate: new Map(),
    ...overrides,
  };
}

describe('resolveLexical — basic tokenization + resolution', () => {
  it('resolves a verb + noun + business phrase from the warehouse worked example', () => {
    const tables = buildTestTables();
    const result = resolveLexical(
      'Pull the warehouse inventory, adjust it +2 from receiving today.',
      tables
    );

    expect(result.verbs.map(v => v.canonicalVerb)).toEqual(['read', 'update']);
    expect(result.targets.map(t => t.targetTerm)).toEqual(['inventory_row']);
    expect(result.operands.map(o => o.operand)).toEqual(['receiving_delta']);
    expect(result.hasBlockedAlias).toBe(false);
  });

  it('skips stop words without populating unmatched', () => {
    const tables = buildTestTables();
    const result = resolveLexical('the the the', tables);
    expect(result.verbs.length).toBe(0);
    expect(result.unmatched.length).toBe(0);
  });

  it('records unmatched meaningful tokens', () => {
    const tables = buildTestTables();
    const result = resolveLexical('xyzzy frobnicate', tables);
    expect(result.unmatched.length).toBeGreaterThan(0);
  });

  it('greedy-matches the longest phrase first', () => {
    const tables = buildTestTables({
      lexicalTerms: [
        {
          rawTerm: 'warehouse inventory',
          canonicalTerm: 'inventory_row',
          phraseClass: 'noun',
          source: 'test' as NonEmpty,
        },
        {
          rawTerm: 'warehouse',
          canonicalTerm: 'warehouse_alone',
          phraseClass: 'noun',
          source: 'test' as NonEmpty,
        },
      ],
    });
    const result = resolveLexical('warehouse inventory', tables);
    expect(result.targets.map(t => t.targetTerm)).toEqual(['inventory_row']);
  });

  it('flags hasBlockedAlias when a blocked phrase appears in the prompt', () => {
    const tables = buildTestTables();
    const result = resolveLexical('please drop everything now', tables);
    expect(result.hasBlockedAlias).toBe(true);
  });

  it('enforces the §2.4 invariant defensively at resolve time', () => {
    // Construct a fixture with a verb that has a NON-ACTION_VERB
    // canonicalTerm. The loader catches this at boot but the resolver
    // double-checks for defense in depth.
    const tables = buildTestTables({
      lexicalTerms: [
        {
          rawTerm: 'frobnicate',
          canonicalTerm: 'bogus_not_in_action_verb',
          phraseClass: 'verb',
          source: 'test' as NonEmpty,
        },
      ],
    });
    expect(() => resolveLexical('frobnicate the records', tables)).toThrow(/ACTION_VERB/);
  });
});
