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
    // Phase 4 batch 2 baseline — table grows in follow-on commits;
    // this guard catches accidental table truncation.
    expect(__testOnly.TABLE.some(e => e.templateId === 'monthly_sales_table_v1')).toBe(true);
  });

  // Phase 4 Cat-5 batch 2: each test in tests/e2e/05-multi-with-contract.e2e.test.ts
  // uses a distinct prompt whose intended templateId is named in the
  // test title. The table below is the literal (prompt, templateId)
  // pair-list for those 10 tests. Every row MUST resolve through
  // pickTemplateForPrompt, and NO row's prompt may also resolve to a
  // different templateId (cross-collision). Both checks pin the
  // selector's behavior so a future table edit that breaks any of the
  // 10 tests fails here first.
  describe('Cat-5 end-to-end test prompt coverage', () => {
    const CAT_5_PAIRS: ReadonlyArray<{ prompt: string; templateId: string }> = [
      {
        prompt: 'Render a monthly sales table for the last quarter.',
        templateId: 'monthly_sales_table_v1',
      },
      {
        prompt: 'Write a quarterly review in prose using the sales and warehouse pulls.',
        templateId: 'quarterly_review_prose_v1',
      },
      {
        prompt: 'Produce an executive report combining prose narrative and a sales table.',
        templateId: 'exec_report_mixed_v1',
      },
      // monthly_files_bundle_v1 NOT covered — spec §4.3 forbids
      // file_bundle in V1 registry templates; E2E-44 stays red until
      // that V1 ratification lands.
      {
        prompt: 'Produce a guarded report with OCT-CONFIDENTIAL guards on every section.',
        templateId: 'secure_report_v1',
      },
      {
        prompt: 'Render a judge decision table from the two source pulls.',
        templateId: 'judge_decision_table_v1',
      },
      {
        prompt: 'Merge sales and warehouse rows into one report.',
        templateId: 'multi_source_merge_v1',
      },
      {
        prompt: 'Produce an APA-formatted research citation list.',
        templateId: 'cited_research_v1',
      },
      {
        prompt: 'Draft an email summarizing the sales/warehouse status.',
        templateId: 'email_draft_v1',
      },
      {
        prompt: 'Produce a quarterly financial summary using the configured template.',
        templateId: 'quarterly_financial_summary_v1',
      },
    ];

    for (const { prompt, templateId } of CAT_5_PAIRS) {
      it(`resolves "${prompt.slice(0, 50)}..." → ${templateId}`, () => {
        const picked = pickTemplateForPrompt(prompt);
        expect(picked, `prompt should resolve: ${prompt}`).not.toBeNull();
        expect(picked!.templateId).toBe(templateId);
        expect(picked!.templateVersion).toBe('1.0.0');
      });
    }

    it('no Cat-5 prompt false-positives against a DIFFERENT templateId', () => {
      // For every test prompt, the resolver must pick that test's own
      // templateId — never some other entry in the lexicon table.
      // Cross-collision would silently route the wrong template to
      // compile + give a passing helper assertion that's actually wrong.
      for (const { prompt, templateId } of CAT_5_PAIRS) {
        const picked = pickTemplateForPrompt(prompt);
        expect(picked!.templateId, `prompt "${prompt}" cross-matched a different template`).toBe(
          templateId
        );
      }
    });
  });

  // Phase 4 Cat 6/7/8/9: these tests submit `promptMode: 'free_text'`
  // and rely on the planner's normal-tier lexicon hook to attach a
  // template when the prompt explicitly calls for one (owner ruling
  // 2026-05-25). Same lexicon mapper; different prompts.
  describe('Cat 6/7/8/9 end-to-end test prompt coverage', () => {
    const CROSS_CAT_PAIRS: ReadonlyArray<{ test: string; prompt: string; templateId: string }> = [
      {
        test: 'E2E-56 (Cat 6 mixed-tier)',
        prompt: 'Board doc with frontier research and on-prem formatting.',
        templateId: 'board_doc_v1',
      },
      {
        test: 'E2E-65 (Cat 7 branching)',
        prompt: 'Four-agent DAG rendered through executive_briefing_v1 contract.',
        templateId: 'executive_briefing_v1',
      },
      {
        test: 'E2E-70 (Cat 7 branching, mixed-tier)',
        prompt: 'Deepest happy path: mixed-tier branches under board_doc_v1.',
        templateId: 'board_doc_v1',
      },
      {
        test: 'E2E-76 (Cat 8 batch)',
        prompt: '100 rows through batch_summary_v1 contract.',
        templateId: 'batch_summary_v1',
      },
      {
        test: 'E2E-90 (Cat 9 multi-source-merge)',
        prompt: 'Cross-system audit reconciliation report.',
        templateId: 'reconciliation_v1',
      },
    ];
    for (const { test, prompt, templateId } of CROSS_CAT_PAIRS) {
      it(`${test} → ${templateId}`, () => {
        const picked = pickTemplateForPrompt(prompt);
        expect(picked, `prompt should resolve: ${prompt}`).not.toBeNull();
        expect(picked!.templateId).toBe(templateId);
      });
    }
  });
});
