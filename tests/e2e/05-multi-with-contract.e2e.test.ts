/**
 * tests/e2e/05-multi-with-contract.e2e.test.ts — E2E v0.4.0 §3.5
 *
 * Category 5: multi-agent runs WITH output contract templates. Compile
 * assembler runs for real — slot match + slot validate + guard eval +
 * format render.
 *
 * Owner directive 2026-05-21: no `it.skip`. Catalog slots fail red with
 * UNIMPLEMENTED_SURFACE because the output-contract template library
 * is not built — the named templates (monthly_sales_table_v1,
 * exec_report_mixed_v1, etc.) do not exist yet.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const BLOCKER = 'OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1';

function contractBlocked(
  testId: string,
  templateName: string,
  lawPins: ReadonlyArray<string>
): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'UNIMPLEMENTED_SURFACE',
    reason: `Output-contract template '${templateName}' not built; compile assembler cannot run with-contract paths.`,
    blockedBy: BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.',
  });
}

describe('E2E Category 5 — multi-agent WITH output contract', () => {
  it('E2E-41-table-monthly-sales: analyst → monthly_sales_table_v1', () => {
    contractBlocked('E2E-41', 'monthly_sales_table_v1', ['HL#11']);
  });
  it('E2E-42-prose-quarterly-review: manager → quarterly_review_prose_v1', () => {
    contractBlocked('E2E-42', 'quarterly_review_prose_v1', ['HL#11']);
  });
  it('E2E-43-mixed-prose-table: sr_manager → exec_report_mixed_v1', () => {
    contractBlocked('E2E-43', 'exec_report_mixed_v1', ['HL#11']);
  });
  it('E2E-44-file-bundle: director → monthly_files_bundle_v1', () => {
    contractBlocked('E2E-44', 'monthly_files_bundle_v1', ['HL#11']);
  });
  it('E2E-45-guarded-confidential: vp → secure_report_v1 with OCT-guards', () => {
    contractBlocked('E2E-45', 'secure_report_v1', ['HL#10', 'HL#11']);
  });
  it('E2E-46-judge-decision-table: director → judge_decision_table_v1', () => {
    contractBlocked('E2E-46', 'judge_decision_table_v1', ['HL#11']);
  });
  it('E2E-47-multi-source-merge: sr_manager → multi_source_merge_v1', () => {
    contractBlocked('E2E-47', 'multi_source_merge_v1', ['HL#8', 'HL#11']);
  });
  it('E2E-48-citation-formatted: vp → cited_research_v1 APA format', () => {
    contractBlocked('E2E-48', 'cited_research_v1', ['HL#11']);
  });
  it('E2E-49-email-draft: sr_manager → email_draft_v1 with subjects', () => {
    contractBlocked('E2E-49', 'email_draft_v1', ['HL#11']);
  });
  it('E2E-50-financial-summary-template: executive → quarterly_financial_summary_v1', () => {
    contractBlocked('E2E-50', 'quarterly_financial_summary_v1', ['HL#11']);
  });
});
