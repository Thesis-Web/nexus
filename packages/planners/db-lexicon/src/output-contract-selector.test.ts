// packages/planners/db-lexicon/src/output-contract-selector.test.ts
//
// Unit coverage for the prompt -> output contract templateId lexicon
// mapper used by the db-lexicon planner's sectioned-tier branch.
//
// Invariants under test:
//   - Case-insensitive substring match (phrase appears anywhere in the
//     prompt, any casing on either side, returns the entry).
//   - Returns null when no entry's phrase appears (compile then follows
//     Hard Law #11 pass-through or the default-template-generator path
//     for multi-item).
//   - Both templateId and templateVersion are returned together — the
//     pair-invariant downstream contracts (workspace pre-pick, planner
//     attachment) rely on this.
//   - First-match-wins by declaration order in the table.

import { describe, expect, it } from 'vitest';
import { pickTemplateForPrompt, __testOnly } from './output-contract-selector.js';

describe('pickTemplateForPrompt — lexicon match', () => {
  it('returns the templateId + version when the phrase appears (exact case match)', () => {
    const picked = pickTemplateForPrompt('Render a monthly sales table for the last quarter.');
    expect(picked).not.toBeNull();
    expect(picked!.templateId).toBe('monthly_sales_table_v1');
    expect(picked!.templateVersion).toBe('1.0.0');
  });

  it('returns the templateId when the phrase appears mixed-case in the prompt', () => {
    const picked = pickTemplateForPrompt('Please render a MONTHLY SALES TABLE for Q1.');
    expect(picked).not.toBeNull();
    expect(picked!.templateId).toBe('monthly_sales_table_v1');
  });

  it('returns the templateId when the phrase appears mid-prompt with surrounding words', () => {
    const picked = pickTemplateForPrompt(
      'I want a one-page handout that includes a monthly sales table plus a summary.'
    );
    expect(picked).not.toBeNull();
    expect(picked!.templateId).toBe('monthly_sales_table_v1');
  });

  it('returns null when no entry phrase appears anywhere in the prompt', () => {
    const picked = pickTemplateForPrompt('Summarize the meeting notes in three bullets.');
    expect(picked).toBeNull();
  });

  it('returns null on an empty prompt', () => {
    const picked = pickTemplateForPrompt('');
    expect(picked).toBeNull();
  });

  it('returns null when only a substring of a phrase appears', () => {
    // 'monthly sales' alone — not the full phrase 'monthly sales table'.
    const picked = pickTemplateForPrompt('What are the monthly sales for Q1?');
    expect(picked).toBeNull();
  });

  it('exposes the seed table so subsequent template additions stay in lockstep with tests', () => {
    expect(__testOnly.TABLE.length).toBeGreaterThan(0);
    // V1 vertical-slice baseline — table grows in follow-on commits;
    // this guard catches accidental table truncation.
    expect(__testOnly.TABLE.some(e => e.templateId === 'monthly_sales_table_v1')).toBe(true);
  });
});
