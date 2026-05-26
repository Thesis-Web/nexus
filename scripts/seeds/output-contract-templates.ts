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
// V1 vertical-slice scope (Phase 4 commit 1): one template
// (monthly_sales_table_v1). Subsequent commits add the other 12 named
// templates declared by the failing E2E wall tests (Cat 5/6/7/8/9).
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
  CompileTemplate,
  CompileSection,
  CompileLocation,
  NonEmpty,
  Sha256Hex,
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
  const templates: CompileTemplate[] = [finalize(buildMonthlySalesTableV1(), privateKeyBase64url)];

  for (const tpl of templates) {
    if (templateStore.exists(tpl.templateId, tpl.templateVersion)) {
      continue;
    }
    templateStore.ingest(tpl, 'phase-4-seed' as NonEmpty);
  }
}
