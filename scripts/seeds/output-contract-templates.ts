// scripts/seeds/output-contract-templates.ts
//
// Outline §D ("Pick output contract / compile template from template DB
// or none") + §J (Compile assembles per template) + Phase 4 vertical
// slice (commit 1).
//
// Seeds the named output contract templates into the persistent
// template registry (SQLite Zone 1 — `templateRegistryStore`) at
// composition-root boot, BEFORE the orchestrator can be reached. The
// planner's prompt->templateId lexicon mapper
// (packages/planners/db-lexicon/src/output-contract-selector.ts) names
// the same templateIds; the planner walks the lexicon, the renderer
// loads the template by id, the assembler renders.
//
// Idempotent: each template is ingested only when not already present
// at its declared version. The store rejects duplicate (id, version)
// rows, so re-running boot does not throw.
//
// Scope: 10 templates seeded (all Cat 5 sectioned tests E2E-41..E2E-50).
// The remaining 3 named templates declared by other categories
// (board_doc_v1 for E2E-56/E2E-70; executive_briefing_v1 for E2E-65;
// batch_summary_v1 for E2E-76; reconciliation_v1 for E2E-90) land in
// follow-on commits keyed by their owning test category — each gets
// added once its containing test's plan-shape is verified to match the
// helper's 2-leg DAG (or its own DAG, when different).
//
// Slot-matcher contract (verified at packages/core/src/compile/
// slot-matcher.ts:55): the matcher keys on `location.expectedSlotId`
// only — `section.assignedAgentId` and `location.assignedAgentId` are
// audit/display metadata, NOT match keys. A registered template is
// therefore reusable across runs and agents; only the slot identifier
// needs to align with the producing nodes' `expectedOutputSlots`.

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import type {
  Base64Url,
  CompileGuard,
  CompileTemplate,
  CompileSection,
  CompileLocation,
  NonEmpty,
  Sha256Hex,
  SlotType,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { computeTemplateDigest } from '../../packages/core/src/compile/template-loader.js';
import type { TemplateRegistryStore } from '../../packages/core/src/compile/template-registry-store.js';

// Ensure sync signing is available — same setup the default-template-
// generator uses so we can sign with the same control-plane key bytes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed25519.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

// Sentinel agent UUID used on registered-template sections.
// `assignedAgentId` is audit metadata only (the slot-matcher binds by
// expectedSlotId, not by agentId), so a deterministic sentinel keeps
// the registered template stable across runs and clear in the ledger.
const TEMPLATE_AGENT_SENTINEL = '00000000-0000-4000-a000-00000000ffff' as const;

/** Build the monthly_sales_table_v1 template — two sections (sales,
 *  warehouse), each binding to slotId 'rows' from a single bulk-pull
 *  location. Format is 'table' so renderers can drive the table
 *  layout. */
function buildMonthlySalesTableV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  const salesLocation: CompileLocation = {
    locationId: 'monthly_sales_table_v1.sales.rows' as NonEmpty,
    position: 0,
    assignedAgentId: TEMPLATE_AGENT_SENTINEL,
    expectedSlotId: 'rows' as NonEmpty,
    slotType: { type: 'table', granularity: 'block' },
    required: true,
    placeholder: 'sales rows',
  };
  const warehouseLocation: CompileLocation = {
    locationId: 'monthly_sales_table_v1.warehouse.rows' as NonEmpty,
    position: 0,
    assignedAgentId: TEMPLATE_AGENT_SENTINEL,
    expectedSlotId: 'rows' as NonEmpty,
    slotType: { type: 'table', granularity: 'block' },
    required: false,
    placeholder: 'warehouse rows (optional context)',
  };
  const sales: CompileSection = {
    sectionId: 'monthly_sales_table_v1.sales' as NonEmpty,
    position: 0,
    title: 'Monthly Sales',
    assignedAgentId: TEMPLATE_AGENT_SENTINEL,
    expectedContentType: 'table',
    locations: [salesLocation],
    formatHint: 'table-of-sales-orders',
  };
  const warehouse: CompileSection = {
    sectionId: 'monthly_sales_table_v1.warehouse' as NonEmpty,
    position: 1,
    title: 'Warehouse Snapshot',
    assignedAgentId: TEMPLATE_AGENT_SENTINEL,
    expectedContentType: 'table',
    locations: [warehouseLocation],
    formatHint: 'table-of-inventory-rows',
  };
  return {
    templateId: 'monthly_sales_table_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'table',
    sections: [sales, warehouse],
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

// ─── Cat-5 template builders ────────────────────────────────────────────────
//
// All Cat-5 sectioned tests in tests/e2e/05-multi-with-contract.e2e.test.ts
// submit the same 2-leg NXS DAG (sales bulk pull + warehouse bulk pull,
// both writing to slotId 'rows'). The templates below all carry the
// 2-section + 2-location skeleton matching that DAG, with the per-
// template format / section titles / slotType / guards reflecting each
// template's literal intent (per /mem2 — names are literal, "close
// enough" is never OK).
//
// helper: build the two parallel locations bound to slotId 'rows' for a
// sales-leg + a warehouse-leg section. Both legs use the same slotType
// per template (table → 'table', prose → 'prose', file_bundle →
// 'asset_ref', etc.) — that's the natural shape because both DAG legs
// produce the same kind of content in the helper's test fixture.

function rowsLocation(
  locationId: NonEmpty,
  slotType: SlotType,
  required: boolean,
  placeholder: string
): CompileLocation {
  return {
    locationId,
    position: 0,
    assignedAgentId: TEMPLATE_AGENT_SENTINEL,
    expectedSlotId: 'rows' as NonEmpty,
    slotType,
    required,
    placeholder,
  };
}

function twoLegSections(
  templateId: string,
  contentType: CompileSection['expectedContentType'],
  slotType: SlotType,
  salesTitle: string,
  salesFormatHint: string,
  warehouseTitle: string,
  warehouseFormatHint: string
): CompileSection[] {
  return [
    {
      sectionId: `${templateId}.sales` as NonEmpty,
      position: 0,
      title: salesTitle,
      assignedAgentId: TEMPLATE_AGENT_SENTINEL,
      expectedContentType: contentType,
      locations: [
        rowsLocation(`${templateId}.sales.rows` as NonEmpty, slotType, true, 'sales rows'),
      ],
      formatHint: salesFormatHint,
    },
    {
      sectionId: `${templateId}.warehouse` as NonEmpty,
      position: 1,
      title: warehouseTitle,
      assignedAgentId: TEMPLATE_AGENT_SENTINEL,
      expectedContentType: contentType,
      locations: [
        rowsLocation(`${templateId}.warehouse.rows` as NonEmpty, slotType, false, 'warehouse rows'),
      ],
      formatHint: warehouseFormatHint,
    },
  ];
}

function buildQuarterlyReviewProseV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'quarterly_review_prose_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'prose',
    sections: twoLegSections(
      'quarterly_review_prose_v1',
      'prose',
      { type: 'prose', granularity: 'paragraph' },
      'Sales Narrative',
      'prose-quarterly-sales-narrative',
      'Warehouse Narrative',
      'prose-quarterly-warehouse-narrative'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildExecReportMixedV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'exec_report_mixed_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'mixed',
    sections: twoLegSections(
      'exec_report_mixed_v1',
      'mixed',
      { type: 'prose', granularity: 'block' },
      'Executive Narrative',
      'prose-executive-narrative',
      'Sales Table',
      'table-of-sales-orders'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

// monthly_files_bundle_v1 NOT SEEDED — spec §4.3 fail-closes
// `format: 'file_bundle'` for V1 registry templates
// (packages/core/src/compile/template-schemas.ts:220 +
// packages/core/src/compile/format-renderer.ts:259). E2E-44 stays
// red until file_bundle is V1-ratified at the renderer + the
// ingestion validator. Adding a non-file_bundle template here would
// be "close enough" / fake — explicitly forbidden by /mem2.

function buildSecureReportV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  // Per /mem2 (names are literal) and the test name
  // "E2E-45-guarded-confidential ... secure_report_v1 with OCT-guards":
  // this template has REAL CompileGuard entries that protect the secure
  // section's content presence. The available GuardCondition operator
  // set (==, !=, >, <, >=, <=, is_empty, is_filled, count_gt, count_lt)
  // does NOT include OCT-level comparison; an OCT-aware operator is a
  // substrate-level addition that belongs in a separate ratified
  // commit, not as a stub here. Each guard uses `is_empty` / `count_lt`
  // on the secure section's rows location and halts on violation so a
  // blank secure report never ships unnoticed.
  const sections = twoLegSections(
    'secure_report_v1',
    'mixed',
    { type: 'prose', granularity: 'block' },
    'Secure Sales Findings',
    'secure-confidential-sales',
    'Secure Warehouse Findings',
    'secure-confidential-warehouse'
  );
  const guards: CompileGuard[] = [
    {
      guardId: 'secure_report_v1.guard.sales_rows_present' as NonEmpty,
      name: 'Secure sales section must carry content',
      when: {
        locationPath: 'secure_report_v1.sales.sales.rows',
        operator: 'is_empty',
      },
      then: {
        targetLocationPath: 'secure_report_v1.sales.sales.rows',
        effect: 'add_warning',
        value: 'Secure sales section is empty — refusing to ship a blank confidential report.',
      },
      severity: 'halt',
    },
    {
      guardId: 'secure_report_v1.guard.warehouse_rows_present' as NonEmpty,
      name: 'Secure warehouse section must carry at least one row when present',
      when: {
        locationPath: 'secure_report_v1.warehouse.warehouse.rows',
        operator: 'count_lt',
        value: 1,
      },
      then: {
        targetLocationPath: 'secure_report_v1.warehouse.warehouse.rows',
        effect: 'add_warning',
        value: 'Secure warehouse section has zero rows — flagged.',
      },
      severity: 'warn_and_mark',
    },
  ];
  return {
    templateId: 'secure_report_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'mixed',
    sections,
    guards,
    denialHandling: 'separate_section',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildJudgeDecisionTableV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'judge_decision_table_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'table',
    sections: twoLegSections(
      'judge_decision_table_v1',
      'table',
      { type: 'table', granularity: 'block' },
      'Sales Findings (judged)',
      'table-judged-sales',
      'Warehouse Findings (judged)',
      'table-judged-warehouse'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildMultiSourceMergeV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'multi_source_merge_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'mixed',
    sections: twoLegSections(
      'multi_source_merge_v1',
      'mixed',
      { type: 'prose', granularity: 'block' },
      'Sales Side (source A)',
      'merged-sales-rows',
      'Warehouse Side (source B)',
      'merged-warehouse-rows'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildCitedResearchV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'cited_research_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'prose',
    sections: twoLegSections(
      'cited_research_v1',
      'prose',
      { type: 'prose', granularity: 'paragraph' },
      'Source A — APA citation',
      'prose-apa-citation-source-a',
      'Source B — APA citation',
      'prose-apa-citation-source-b'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildEmailDraftV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'email_draft_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'prose',
    sections: twoLegSections(
      'email_draft_v1',
      'prose',
      { type: 'prose', granularity: 'paragraph' },
      'Subject + Sales status body',
      'email-draft-sales-status',
      'Warehouse status body',
      'email-draft-warehouse-status'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

function buildQuarterlyFinancialSummaryV1(): Omit<CompileTemplate, 'templateDigest' | 'signature'> {
  return {
    templateId: 'quarterly_financial_summary_v1' as NonEmpty,
    templateVersion: '1.0.0' as NonEmpty,
    format: 'mixed',
    sections: twoLegSections(
      'quarterly_financial_summary_v1',
      'mixed',
      { type: 'prose', granularity: 'block' },
      'Quarterly Sales Financials',
      'mixed-quarterly-sales-financials',
      'Quarterly Warehouse Financials',
      'mixed-quarterly-warehouse-financials'
    ),
    guards: [],
    denialHandling: 'inline',
    createdAt: nowIso(),
    createdBy: 'default',
  };
}

/** Sign a digest with the control-plane private key (base64url-encoded). */
function signDigest(digestHex: string, privateKeyBase64url: string): Base64Url {
  const privKeyBytes = new Uint8Array(Buffer.from(privateKeyBase64url, 'base64url'));
  const msgBytes = new TextEncoder().encode(digestHex);
  const sigBytes = ed25519.sign(msgBytes, privKeyBytes);
  return Buffer.from(sigBytes).toString('base64url') as Base64Url;
}

/** Materialize a CompileTemplate (digest + signature) from a base shape.
 *  `computeTemplateDigest` reads only the 8 canonical fields
 *  (templateId, templateVersion, format, sections, guards,
 *  denialHandling, createdAt, createdBy) — templateDigest + signature
 *  are NOT inputs to the digest, but the function's parameter type
 *  asks for a full CompileTemplate, so we supply both as
 *  not-yet-real placeholders, then overwrite with the real digest +
 *  its signature on the returned object. */
function finalize(
  base: Omit<CompileTemplate, 'templateDigest' | 'signature'>,
  privateKeyBase64url: string
): CompileTemplate {
  const PLACEHOLDER_DIGEST = '0'.repeat(64) as Sha256Hex;
  const PLACEHOLDER_SIGNATURE = 'placeholder' as Base64Url;
  const templateDigest = computeTemplateDigest({
    ...base,
    templateDigest: PLACEHOLDER_DIGEST,
    signature: PLACEHOLDER_SIGNATURE,
  });
  const signature = signDigest(templateDigest, privateKeyBase64url);
  return { ...base, templateDigest, signature };
}

/**
 * Seed all Phase 4 named output contract templates. Call ONCE at
 * composition-root boot, after the registry store is initialized and
 * the control-plane private key is loaded. Idempotent: skips templates
 * already present at their declared version.
 */
export function seedOutputContractTemplates(
  templateStore: TemplateRegistryStore,
  privateKeyBase64url: string
): void {
  const bases: Array<Omit<CompileTemplate, 'templateDigest' | 'signature'>> = [
    buildMonthlySalesTableV1(),
    buildQuarterlyReviewProseV1(),
    buildExecReportMixedV1(),
    // buildMonthlyFilesBundleV1 — NOT seeded; spec §4.3 forbids
    // file_bundle in V1 registry templates. See comment block above.
    buildSecureReportV1(),
    buildJudgeDecisionTableV1(),
    buildMultiSourceMergeV1(),
    buildCitedResearchV1(),
    buildEmailDraftV1(),
    buildQuarterlyFinancialSummaryV1(),
  ];

  for (const base of bases) {
    if (templateStore.exists(base.templateId, base.templateVersion)) {
      continue;
    }
    templateStore.ingest(finalize(base, privateKeyBase64url), 'phase-4-seed' as NonEmpty);
  }
}
