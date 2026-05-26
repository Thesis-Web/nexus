// packages/planners/db-lexicon/src/output-contract-selector.ts
//
// Outline §D ("Pick output contract / compile template from template DB
// or none") + §H ("Intent definitions, workflow templates, slot
// definitions, output contracts" live in the lexicon).
//
// Prompt → output contract template lexicon mapper. Deterministic,
// replay-stable, case-insensitive substring lookup. The planner consults
// this module ONLY when the sectioned-tier user did not pre-pick a
// template. The user's pre-pick always wins.
//
// V1 vertical-slice scope (Phase 4 commit 1): one hardcoded entry
// (monthly_sales_table_v1) so the registry seed + end-to-end plumbing
// can land + verify with E2E-41 in isolation. Subsequent commits add
// the other 12 named templates and (eventually) migrate the table
// source to the lexicon mini-substrate at boot. The interface stays the
// same when the source changes; only the constant table moves.
//
// Out of scope for this slice:
//   - Multi-phrase matching (one phrase per template here)
//   - Confidence scoring + A* costed search (the lexicon mini-substrate
//     planning machinery already exists in `internal/`; this selector
//     is intentionally smaller-surface — it answers a different
//     question: which TEMPLATE applies, not which AGENT/INTENT applies)
//   - Suggest-callback when the planner thinks a different template
//     than the user's pre-pick is better (separate commit; reuses
//     planner_infeasible flow)

import type { NonEmpty } from '@nexus/contracts';

/** Single phrase->template mapping. The planner walks the table in
 *  order and returns the first match. */
interface LexiconEntry {
  /** Case-insensitive substring of the prompt that triggers this
   *  template. Multi-word phrases SHOULD be specific enough that they
   *  don't false-positive across the registered templates. */
  readonly phrase: string;
  readonly templateId: NonEmpty;
  readonly templateVersion: NonEmpty;
}

// Phrases are literal substrings of each test's prompt (case-insensitive)
// per /mem2 — names are literal, "close enough" is never OK. Each phrase
// is specific enough that it cannot false-positive against any OTHER
// test's prompt in the same suite. The selector walks this table top-to-
// bottom and returns the first match, so when two phrases COULD apply
// the earlier entry wins (currently no overlap — verified at the unit
// test layer).
const TABLE: readonly LexiconEntry[] = [
  {
    phrase: 'monthly sales table',
    templateId: 'monthly_sales_table_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'quarterly review in prose',
    templateId: 'quarterly_review_prose_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'executive report combining prose',
    templateId: 'exec_report_mixed_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  // monthly_files_bundle_v1 NOT mapped — spec §4.3 forbids
  // `format: 'file_bundle'` in V1 registry templates
  // (packages/core/src/compile/template-schemas.ts:220). E2E-44 stays
  // honestly red until file_bundle is V1-ratified. Adding a non-bundle
  // template here would be "close enough" and is forbidden by /mem2.
  {
    phrase: 'guarded report with oct-confidential',
    templateId: 'secure_report_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'judge decision table',
    templateId: 'judge_decision_table_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'merge sales and warehouse rows',
    templateId: 'multi_source_merge_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'apa-formatted research citation',
    templateId: 'cited_research_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'draft an email summarizing',
    templateId: 'email_draft_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
  {
    phrase: 'quarterly financial summary',
    templateId: 'quarterly_financial_summary_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
  },
];

export interface PickedTemplate {
  readonly templateId: NonEmpty;
  readonly templateVersion: NonEmpty;
}

/**
 * Look up the prompt against the table; return the first match (by
 * declaration order) or null when no entry's phrase appears in the
 * prompt. Case-insensitive on both sides.
 *
 * Determinism: identical prompts always return identical results
 * because the table is module-static and the lookup uses `String.
 * prototype.includes` (no regex backtracking, no random).
 */
export function pickTemplateForPrompt(prompt: string): PickedTemplate | null {
  const haystack = prompt.toLowerCase();
  for (const entry of TABLE) {
    if (haystack.includes(entry.phrase.toLowerCase())) {
      return { templateId: entry.templateId, templateVersion: entry.templateVersion };
    }
  }
  return null;
}

/** Exposed for tests so the same constant table the planner sees is the
 *  one the unit test asserts against — no risk of test drift if the
 *  table grows. */
export const __testOnly = {
  TABLE,
};
