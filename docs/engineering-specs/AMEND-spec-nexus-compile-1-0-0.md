# Nexus Stack — Engineering Spec Amendment: Compile-Ref

# Version: v1.0.0
# Filename: AMEND-spec-nexus-compile-1-0-0.md
# Status: RATIFIED — Session 23
# Owner: James Huson / Lake Area LLC
# Date: 2026-05-01
# Governing blueprint: AMEND-blueprint-nexus-compile-1-1-1.md
# Purpose: implementation law for compile-ref only

---

## 0. Precedence and Scope

### 0.1 Law Stack

1. `nexus-complete-end-to-end-flow-v4.8.md`
2. `nexus-owner-ratification-v1-4-12.md`
3. `nexus-blueprint-v1-5-13.md`
4. `AMEND-blueprint-nexus-compile-1-1-1.md` — compile-ref blueprint law
5. `AMEND-blueprint-nexus-infra-externals-v1-0-0.md`
6. `nexus-engineering-spec-v1-8-26.md`
7. `AMEND-spec-nexus-infra-externals-v0-2-5.md`
8. This spec — compile-ref implementation law only
9. Repo implementation

Blueprint wins all conflicts. Holes require owner-approved best-solve before the builder proceeds.

### 0.2 Resolved Audit Items (v1–v4)

All prior audit items are CLOSED. Full history in v4 draft §0.2–§0.2.2.

Key decisions carried forward:
- `runId` removed from `CompileTemplate` — templates are Zone 1 [blueprint §4]
- `CompileRequest` gets optional `templateId`, `templateVersion`, `preferences` (additive)
- Admin ingestion requires BOTH admin auth AND signed template body
- `template_ingested` uses synthetic admin-operation UUID as `runId`
- `TemplateLoader`/`TemplateVerifier` are async (Ed25519 verification is async)
- Guard-halt catch path emits ledger events before re-throwing
- `file_bundle` fail-closed everywhere in V1 — no fallback

### 0.3 Scope

Builds the template-aware deterministic compile assembler. Does NOT build items listed in [blueprint §19].

### 0.4 Naming Law

| Name | Package | What |
|---|---|---|
| `CompileTemplate`, `CompileSection`, `CompileLocation` | contracts | Template tree [blueprint §6] |
| `CompileGuard`, `GuardCondition`, `GuardAction` | contracts | Guard system [blueprint §7] |
| `CompileFormat`, `DenialHandling`, `ContentGranularity` | contracts | Enums |
| `SlotTypeName`, `SlotType` | contracts | 10 slot types [blueprint §6.4] |
| `CompilePreferences`, `AgentTaskSummary`, `ContractDesigner` | contracts | Session/future types |
| `TemplateRegistryStore` | core | SQLite Zone 1 persistence |
| `TemplateLoader`, `TemplateVerifier` | core | Load + verify at runtime |
| `DefaultTemplateGenerator` | core | Session-only default template |
| `SlotMatcher` | core | slotId → location matching |
| `SlotValidator`, `EntityRefResolver` | core | Per-type fill validation |
| `GuardEvaluator` | core | Metadata-only guard evaluation |
| `CompileAssembler` | core | Full assembly pipeline |
| `FormatRenderer` | core | Per-format output rendering |
| `DenialMarkerInserter` | core | Missing-slot markers |
| `DeterministicRenderer` | core | Clean rebuild — same file/export |

CompileTemplate ≠ OutputContract. Different types, zones, lifecycles [blueprint §0.1].

---

## 1. Repository Placement

### 1.1 New Files

| File | Path |
|---|---|
| `compile-template.ts` | `packages/contracts/src/externals/compile-template.ts` |
| `template-registry-store.ts` | `packages/core/src/compile/template-registry-store.ts` |
| `template-loader.ts` | `packages/core/src/compile/template-loader.ts` |
| `default-template-generator.ts` | `packages/core/src/compile/default-template-generator.ts` |
| `slot-matcher.ts` | `packages/core/src/compile/slot-matcher.ts` |
| `slot-validator.ts` | `packages/core/src/compile/slot-validator.ts` |
| `guard-evaluator.ts` | `packages/core/src/compile/guard-evaluator.ts` |
| `compile-assembler.ts` | `packages/core/src/compile/compile-assembler.ts` |
| `format-renderer.ts` | `packages/core/src/compile/format-renderer.ts` |
| `denial-marker-inserter.ts` | `packages/core/src/compile/denial-marker-inserter.ts` |
| `template-schemas.ts` | `packages/core/src/compile/template-schemas.ts` |
| `compile-errors.ts` | `packages/core/src/compile/compile-errors.ts` |
| `templates.ts` | `packages/interfaces/api/src/routes/templates.ts` |

### 1.2 Enhanced Files

| File | Change |
|---|---|
| `contracts/externals/compiler.ts` | Add optional fields to `CompileRequest` |
| `contracts/externals/index.ts` | Barrel export `compile-template.ts` |
| `contracts/interfaces/index.ts` | Add 7 `RunEventType` values |
| `contracts/constants/index.ts` | Add 8 denial codes |
| `core/compile/deterministic-renderer.ts` | Clean rebuild — same file, same export |
| `core/compile/compile-service.ts` | Template-aware enhancement |
| `core/compile/index.ts` | Barrel additions |
| `api/routes/compile.ts` | Accept templateId/templateVersion/preferences |
| `api/routes/index.ts` | Register template admin route |

### 1.3 Rules

No Zod in contracts. No core imports from API routes. `DeterministicRenderer` keeps filename/export. `strictNullChecks` + `exactOptionalPropertyTypes` apply.

---

## 2. Contracts — `compile-template.ts`

```typescript
import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty } from '../types/index.js';

export type CompileFormat = 'prose' | 'table' | 'raw' | 'mixed' | 'file_bundle';
export type DenialHandling = 'inline' | 'separate_section' | 'omit';
export type ContentGranularity = 'block' | 'paragraph' | 'sentence' | 'inline';
export type EntityRegistryName = 'actor' | 'principal' | 'system' | 'connector' | 'template';

export type SlotTypeName =
  | 'string' | 'number' | 'date' | 'enum' | 'entity_ref'
  | 'prose' | 'table' | 'repeating_group' | 'asset_ref' | 'computed';

export interface SlotType {
  type: SlotTypeName;
  granularity?: ContentGranularity;
  maxLength?: number;
  min?: number;
  max?: number;
  values?: string[];
  registry?: EntityRegistryName;      // required when type === 'entity_ref'
  childLocations?: CompileLocation[];  // required when type === 'repeating_group'
  computeFn?: string;                  // required when type === 'computed'
  computeScope?: 'same_agent';        // required when type === 'computed'
}

export interface CompileLocation {
  locationId: NonEmpty;
  position: number;
  assignedAgentId: Uuid;
  expectedSlotId: NonEmpty;
  slotType: SlotType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export interface CompileSection {
  sectionId: NonEmpty;
  position: number;
  title: string;
  assignedAgentId: Uuid;
  expectedContentType: 'prose' | 'table' | 'data' | 'file' | 'mixed';
  locations: CompileLocation[];
  formatHint?: string;
}

export interface GuardCondition {
  locationPath: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<='
          | 'is_empty' | 'is_filled' | 'count_gt' | 'count_lt';
  value?: string | number | boolean;
}

export interface GuardAction {
  targetLocationPath: string;
  effect: 'set_required' | 'set_value' | 'block_section' | 'add_warning';
  value?: string | number | boolean;
}

export interface CompileGuard {
  guardId: NonEmpty;
  name: string;
  when: GuardCondition;
  then: GuardAction;
  severity: 'halt' | 'warn_and_mark' | 'auto_fix';
}

export interface CompileTemplate {
  templateId: NonEmpty;
  templateVersion: NonEmpty;
  format: CompileFormat;
  sections: CompileSection[];
  guards: CompileGuard[];
  denialHandling: DenialHandling;
  createdAt: IsoTimestamp;
  createdBy: 'user' | 'orchestrator' | 'contract_designer' | 'default';
  templateDigest: Sha256Hex;
  signature: Base64Url;
}

export interface CompilePreferences {
  format: CompileFormat;
  sectionOrder?: string[];
  denialHandling?: DenialHandling;
  locale?: string;
  customInstructions?: string;
}

export interface AgentTaskSummary {
  agentId: Uuid;
  taskId: Uuid;
  taskSummary: NonEmpty;
  expectedOutputSlots: NonEmpty[];
  capabilities: string[];
}

export interface ContractDesigner {
  readonly designerId: NonEmpty;
  readonly designerVersion: NonEmpty;
  designTemplate(
    runId: Uuid,
    agentSummaries: AgentTaskSummary[],
    outputPreferences: CompilePreferences | null
  ): Promise<CompileTemplate>;
}
```

`ContractDesigner`: interface only in V1 [blueprint §9].

Field law, slot types, guard semantics, denial modes, content granularity — all per blueprint §6–§8, §12. No restatement here.

Digest: `sha256(canonicalize({ templateId, templateVersion, format, sections, guards, denialHandling, createdAt, createdBy }))` [blueprint §11.2].

### 2.1 CompileRequest Enhancement

```typescript
export interface CompileRequest {
  runId: Uuid;
  compilerSocketId: NonEmpty;
  mailboxId: NonEmpty;
  outputContractId: Uuid;
  requestedAt: IsoTimestamp;
  templateId?: NonEmpty;
  templateVersion?: NonEmpty;
  preferences?: CompilePreferences;
}
```

- `templateId` absent → `DefaultTemplateGenerator`
- `templateId` present, `templateVersion` absent → latest ingested version
- Both present → exact version
- `templateVersion` without `templateId` → reject at route validation
- `preferences` honored only by default template generation; ignored for registry templates
- `Compiler.compile()` signature unchanged

### 2.2 Denial Codes

Add to `contracts/constants/index.ts`:

```typescript
TEMPLATE_NOT_FOUND: 'template_not_found',
TEMPLATE_SIGNATURE_INVALID: 'template_signature_invalid',
TEMPLATE_DIGEST_MISMATCH: 'template_digest_mismatch',
TEMPLATE_VALIDATION_FAILED: 'template_validation_failed',
SLOT_VALIDATION_FAILED: 'slot_validation_failed',
GUARD_HALT: 'guard_halt',
FILL_TYPE_MISMATCH: 'fill_type_mismatch',
ASSEMBLY_INCOMPLETE: 'assembly_incomplete',
```

---

## 3. Template Registry Store

Path: `packages/core/src/compile/template-registry-store.ts`

SQLite in existing Nexus DB [blueprint §4.1].

### 3.1 Schema

```sql
CREATE TABLE IF NOT EXISTS compile_templates (
  template_id       TEXT NOT NULL,
  template_version  TEXT NOT NULL,
  format            TEXT NOT NULL,
  sections_json     TEXT NOT NULL,
  guards_json       TEXT NOT NULL,
  denial_handling   TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  template_digest   TEXT NOT NULL,
  signature         TEXT NOT NULL,
  ingested_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ingested_by       TEXT NOT NULL,
  PRIMARY KEY (template_id, template_version)
);
CREATE INDEX IF NOT EXISTS idx_compile_templates_id ON compile_templates (template_id);
CREATE INDEX IF NOT EXISTS idx_compile_templates_latest ON compile_templates (template_id, ingested_at DESC);
```

Rows are never updated. "Latest" = `ingested_at DESC` for V1 [blueprint §11.4].

### 3.2 Interface

```typescript
export interface TemplateRegistryStore {
  initialize(): void;
  ingest(template: CompileTemplate, ingestedBy: NonEmpty): void;
  getByVersion(templateId: NonEmpty, templateVersion: NonEmpty): CompileTemplate | null;
  getLatest(templateId: NonEmpty): CompileTemplate | null;
  listVersions(templateId: NonEmpty): CompileTemplate[];
  listTemplateIds(): NonEmpty[];
  exists(templateId: NonEmpty, templateVersion: NonEmpty): boolean;
}
```

---

## 4. Template Validation — Zod Schemas

Path: `packages/core/src/compile/template-schemas.ts`

### 4.1 API Boundary

```typescript
export interface TemplateValidator {
  validateForIngestion(template: unknown): CompileTemplate;
}
```

Implementation in core, injected via bootstrap. API routes never import this file.

### 4.2 Schemas

```typescript
import { z } from 'zod';

export const ContentGranularitySchema = z.enum(['block', 'paragraph', 'sentence', 'inline']);
export const SlotTypeNameSchema = z.enum([
  'string', 'number', 'date', 'enum', 'entity_ref',
  'prose', 'table', 'repeating_group', 'asset_ref', 'computed',
]);
export const CompileFormatSchema = z.enum(['prose', 'table', 'raw', 'mixed', 'file_bundle']);
export const DenialHandlingSchema = z.enum(['inline', 'separate_section', 'omit']);
export const EntityRegistryNameSchema = z.enum(['actor', 'principal', 'system', 'connector', 'template']);

export const SlotTypeSchema: z.ZodType = z.lazy(() =>
  z.object({
    type: SlotTypeNameSchema,
    granularity: ContentGranularitySchema.optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    values: z.array(z.string().min(1)).min(1).optional(),
    registry: EntityRegistryNameSchema.optional(),
    childLocations: z.array(CompileLocationSchema).min(1).optional(),
    computeFn: z.string().min(1).optional(),
    computeScope: z.literal('same_agent').optional(),
  }).superRefine((data, ctx) => {
    if (data.type === 'prose' && !data.granularity)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'prose requires granularity' });
    if (data.type === 'enum' && (!data.values || data.values.length === 0))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'enum requires values' });
    if (data.type === 'repeating_group' && (!data.childLocations || data.childLocations.length === 0))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repeating_group requires childLocations' });
    if (data.type === 'computed' && !data.computeFn)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'computed requires computeFn' });
    if (data.type === 'computed' && data.computeScope !== 'same_agent')
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'V1: computed requires same_agent' });
    if (data.type === 'entity_ref' && !data.registry)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entity_ref requires registry' });
  })
);

export const CompileLocationSchema: z.ZodType = z.object({
  locationId: z.string().min(1), position: z.number().int().nonnegative(),
  assignedAgentId: z.string().uuid(), expectedSlotId: z.string().min(1),
  slotType: SlotTypeSchema, required: z.boolean(),
  placeholder: z.string().optional(), defaultValue: z.string().optional(),
});
export const CompileSectionSchema = z.object({
  sectionId: z.string().min(1), position: z.number().int().nonnegative(),
  title: z.string(), assignedAgentId: z.string().uuid(),
  expectedContentType: z.enum(['prose', 'table', 'data', 'file', 'mixed']),
  locations: z.array(CompileLocationSchema).min(1), formatHint: z.string().optional(),
});
export const GuardConditionSchema = z.object({
  locationPath: z.string().min(1),
  operator: z.enum(['==','!=','>','<','>=','<=','is_empty','is_filled','count_gt','count_lt']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export const GuardActionSchema = z.object({
  targetLocationPath: z.string().min(1),
  effect: z.enum(['set_required', 'set_value', 'block_section', 'add_warning']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export const CompileGuardSchema = z.object({
  guardId: z.string().min(1), name: z.string().min(1),
  when: GuardConditionSchema, then: GuardActionSchema,
  severity: z.enum(['halt', 'warn_and_mark', 'auto_fix']),
});
export const CompileTemplateSchema = z.object({
  templateId: z.string().min(1), templateVersion: z.string().min(1),
  format: CompileFormatSchema, sections: z.array(CompileSectionSchema).min(1),
  guards: z.array(CompileGuardSchema), denialHandling: DenialHandlingSchema,
  createdAt: z.string().min(1),
  createdBy: z.enum(['user', 'orchestrator', 'contract_designer', 'default']),
  templateDigest: z.string().length(64), signature: z.string().min(1),
});
```

### 4.3 Structural Validation (post-Zod)

No duplicate `sectionId`, `locationId`, or `guardId`. All guard `locationPath` and `targetLocationPath` must resolve against template sections/locations. `any_location` is a valid wildcard. Path resolution: first segment = sectionId, subsequent = locationId walk. `file_bundle` rejected at ingestion for V1 registry templates.

---

## 5. Template Signing, Loading, Verification

Path: `packages/core/src/compile/template-loader.ts`

Key separation per [blueprint §11.1]. Template-signing key is distinct from artifact signer, approver, and manifest/policy signer.

### 5.1 TemplateVerifier

```typescript
export interface TemplateVerifier {
  verifyOrThrow(template: CompileTemplate): Promise<void>;
  verifyDigest(template: CompileTemplate): boolean;
  verifySignature(template: CompileTemplate): Promise<boolean>;
}
```

`verifyOrThrow`: recompute digest → compare → verify Ed25519 sig over digest. Throws `CompileTemplateError(TEMPLATE_DIGEST_MISMATCH)` or `CompileTemplateError(TEMPLATE_SIGNATURE_INVALID)`.

### 5.2 TemplateLoader

```typescript
export interface TemplateLoader {
  loadAndVerify(templateId: NonEmpty, templateVersion?: NonEmpty): Promise<CompileTemplate>;
}
```

Load from store → verify → return. Throws `TEMPLATE_NOT_FOUND` if missing.

### 5.3 Template-Signing Script

`scripts/sign-template.ts` — same pattern as `scripts/sign-policy.ts`.

---

## 6. Template Ingestion Route

Path: `packages/interfaces/api/src/routes/templates.ts`

`POST /admin/templates` — [blueprint §11.3]

### 6.1 Auth

Requires BOTH admin authorization (caller authority) AND valid Ed25519 template signature (body integrity).

### 6.2 Dependencies

```typescript
export interface TemplateRouteDeps {
  authorizeAdminRequest: AdminRequestAuthorizer;
  templateStore: TemplateRegistryStore;
  templateValidator: TemplateValidator;
  templateVerifier: TemplateVerifier;
  runLedgerWriter: RunLedgerWriter;
}
```

### 6.3 Behavior

1. Authorize → 2. Parse → 3. Validate (Zod + structure) → 4. Verify (digest + sig) → 5. Reject duplicate → 6. Insert → 7. Emit `template_ingested` → 8. Return 201

Errors: 400 (validation), 401 (no auth), 403 (insufficient auth), 409 (duplicate), 500.

### 6.4 Ingestion Audit Event

`template_ingested` uses synthetic admin-operation UUID as `runId` (no compile run exists). Detail includes `adminOperation: true` to distinguish from runtime events.

---

## 7. Compile Errors

Path: `packages/core/src/compile/compile-errors.ts`

Do NOT use `NexusSecurityViolation` for compile assembly failures.

```typescript
export class CompileTemplateError extends Error {
  readonly denialCode: DenialCode;
}

export class CompileAssemblyError extends Error {
  readonly denialCode: DenialCode;
}

export class CompileGuardHaltError extends CompileAssemblyError {
  readonly guardId: NonEmpty;
  readonly guardName: NonEmpty;
  readonly conditionLocationPath: string;
  readonly conditionOperator: string;
  readonly actionTarget: string;
}
```

---

## 8. Core Interfaces

### 8.1 DefaultTemplateGenerator

```typescript
export interface DefaultTemplateGenerator {
  generate(runId: Uuid, items: MailboxItem[], preferences: CompilePreferences | null): CompileTemplate;
}
```

Layout law: group by agentId (sorted), one section per agent, one prose/block location per item, `default_<runId>` as templateId, signed with control-plane key, NOT inserted into registry [blueprint §6.2].

### 8.2 SlotMatcher

```typescript
export interface SlotMatchResult {
  matched: Map<string, MatchedSlot>;
  unmatched: UnmatchedLocation[];
  orphaned: OrphanedItem[];
}
export interface MatchedSlot { location: CompileLocation; items: MailboxItem[]; }
export interface UnmatchedLocation { location: CompileLocation; sectionId: NonEmpty; required: boolean; }
export interface OrphanedItem { item: MailboxItem; reason: 'no_matching_location'; }
```

Algorithm — [blueprint §8.2]:

```
matchSlots(template, items):
  slotIndex = Map<slotId, MailboxItem[]> from items
  consumedIds = Set()
  for section in sections.sort(byPosition):
    for location in locations.sort(byPosition):
      candidates = slotIndex.get(location.expectedSlotId)
      if none: push unmatched; continue
      sorted = candidates.sort(createdAt ASC, mailboxItemId ASC)
      if repeating_group: match all; else: match oldest
      mark consumed
  orphaned = items not in consumedIds
```

### 8.3 SlotValidator

```typescript
export interface SlotValidationResult { valid: boolean; errors: SlotValidationError[]; }
export interface SlotValidationError { locationId: NonEmpty; slotType: SlotTypeName; reason: string; }

export interface EntityRefResolver {
  resolve(registry: EntityRegistryName, entityId: NonEmpty): Promise<boolean>;
}

export interface SlotValidator {
  validate(location: CompileLocation, fillValue: unknown): Promise<SlotValidationResult>;
}
```

Constructor: `SlotValidatorImpl(entityRefResolver: EntityRefResolver, payloadResolvers: PayloadResolver[])`

10 slot types validated per [blueprint §8.3]. `entity_ref` uses `SlotType.registry` to select owning registry via injected `EntityRefResolver`.

### 8.4 GuardEvaluator

```typescript
export interface GuardEvaluationResult {
  passed: boolean;
  firedGuards: FiredGuard[];
  haltGuard: FiredGuard | null;
  modifications: GuardModification[];
  warnings: GuardWarning[];
}
export interface FiredGuard {
  guardId: NonEmpty; guardName: string; severity: CompileGuard['severity'];
  condition: GuardCondition; action: GuardAction;
}
export interface GuardModification {
  targetLocationPath: string; effect: GuardAction['effect'];
  value?: string | number | boolean; sourceGuardId: NonEmpty;
}
export interface GuardWarning { locationPath: string; message: string; sourceGuardId: NonEmpty; }
```

Algorithm — [blueprint §7.5]:

```
evaluateGuards(template, matchResult, items):
  metadataIndex = buildFillMetadataIndex(matchResult)
  for guard in template.guards:
    if evaluateCondition(guard.when, metadataIndex):
      if halt: return { passed: false, haltGuard: fired }
      if auto_fix: push modification
      if warn_and_mark: push warning
  return { passed: true }

evaluateCondition(condition, index):
  'any_location' → match any; else → lookup by path
  operators: is_empty, is_filled, ==, !=, >, <, >=, <=, count_gt, count_lt
  guards read METADATA only — never prose content [blueprint §7.4]
  set_value is static-only in V1 [blueprint §7 + v4 §11.4]
```

### 8.5 FormatRenderer

```typescript
export interface FormatRenderer {
  render(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    warnings: GuardWarning[]
  ): string;
}
```

Prose renderer walks sections/locations by position, emits by granularity (block→paragraph→sentence→inline) [blueprint §6.5, §8.5]. Table/raw/mixed per [blueprint §8.5]. `file_bundle` fail-closed in V1.

### 8.6 DenialMarkerInserter

Three modes per [blueprint §12]. Omission is never audit-silent.

### 8.7 CompileAssembler

```typescript
export interface ValidationFailure { locationId: NonEmpty; mailboxItemId: NonEmpty; reason: NonEmpty; }

export interface AssemblyResult {
  body: string;
  bodyDigest: Sha256Hex;
  matchResult: SlotMatchResult;
  guardResult: GuardEvaluationResult;
  validationFailures: ValidationFailure[];
  format: CompileFormat;
  partial: boolean;
}

export interface CompileAssembler {
  assemble(template: CompileTemplate, items: MailboxItem[], payloadResolvers: PayloadResolver[]): Promise<AssemblyResult>;
}
```

Constructor: `CompileAssemblerImpl(slotMatcher, slotValidator, guardEvaluator, formatRenderers: Map<CompileFormat, FormatRenderer>, denialMarkerInserter)`

Pipeline:

```
assemble(template, items, resolvers):
  Phase 1: matchResult = slotMatcher.match(template, items)
  Phase 2: resolve fills via PayloadResolver, validate via slotValidator
           required invalid → throw CompileAssemblyError(SLOT_VALIDATION_FAILED)
           optional invalid → push to validationFailures, skip
  Phase 3: guardResult = guardEvaluator.evaluate(template, matchResult, items)
           halt → throw CompileGuardHaltError (with condition/operator/target from guard)
           auto_fix → apply modifications
  Phase 4: denialOutput = denialMarkerInserter.insert(template, unmatched, denialHandling)
  Phase 5: body = formatRenderers.get(format).render(...)
           partial = any required unmatched OR validationFailures.length > 0
  return { body, bodyDigest, matchResult, guardResult, validationFailures, format, partial }
```

---

## 9. DeterministicRenderer — Clean Production Build

Path: `packages/core/src/compile/deterministic-renderer.ts` [blueprint §18.1]

Clean build from scratch. Same `Compiler` interface. Same filename/export.

### 9.1 Constructor

```typescript
constructor(
  compilerSocketId: NonEmpty, signingKey: string, outputRoot: string,
  templateLoader: TemplateLoader, defaultTemplateGenerator: DefaultTemplateGenerator,
  compileAssembler: CompileAssembler, payloadResolvers: PayloadResolver[],
  runLedgerWriter: RunLedgerWriter
)
```

### 9.2 Pipeline

```
async compile(request, contract, items):

  // Step 1: Template resolution
  template = request.templateId
    ? await templateLoader.loadAndVerify(request.templateId, request.templateVersion)
    : defaultTemplateGenerator.generate(request.runId, items, request.preferences ?? null)

  // Step 2: Emit compile_template_loaded
  ledger.writeEvent(compile_template_loaded, { templateId, templateVersion, templateDigest,
    signatureVerified: true, createdBy, systemGenerated: createdBy === 'default',
    sectionCount, guardCount })

  // Step 3: Assemble
  try:
    result = await compileAssembler.assemble(template, items, payloadResolvers)
  catch error:
    if CompileGuardHaltError:
      ledger.writeEvent(compile_guard_fired, { guardId, guardName, severity: 'halt',
        conditionLocationPath: error.conditionLocationPath,
        conditionOperator: error.conditionOperator,
        actionEffect: 'halt', actionTarget: error.actionTarget })
      ledger.writeEvent(compile_guard_halt, { guardId, guardName })
    throw

  // Step 4: Emit per-slot events
  for each matched: ledger.writeEvent(compile_slot_matched, ...)
  for each unmatched: ledger.writeEvent(compile_slot_missing, reason: 'no_matching_fill')
  for each validationFailure: ledger.writeEvent(compile_slot_missing, reason: 'validation_failed', validationReason)
  for each orphaned: ledger.writeEvent(compile_slot_missing, reason: 'no_matching_location')

  // Step 5: Emit guard events (non-halt)
  for each firedGuard: ledger.writeEvent(compile_guard_fired, ...)

  // Step 6: Write body, emit compile_assembly_complete
  write body to runs/compile/<runId>/<artifactId>.txt
  ledger.writeEvent(compile_assembly_complete, { templateId, templateVersion, format,
    itemCount, unmatchedCount, orphanedCount, validationFailureCount,
    guardsFired, warningCount, partial, bodyDigest })

  // Step 7: Build + sign FinalResponseArtifact
  return { ...artifactBase, signature: signArtifact(artifactBase, signingKey) }
```

Constraints: no model call, no action call, no mailbox mutation, deterministic ordering, no registry writes, actor-registration exempt [blueprint §21.4].

---

## 10. Compile Route Enhancement

Path: `packages/interfaces/api/src/routes/compile.ts`

Request body: `{ templateId?: string, templateVersion?: string, preferences?: CompilePreferences }`

`templateVersion` without `templateId` rejected. `preferences` honored only by default generation. No raw templates accepted. Fields passed to `CompileRequest` as-is.

---

## 11. Run Ledger Events

### 11.1 New RunEventType Values

```typescript
| 'template_ingested'          // admin lifecycle — synthetic runId
| 'compile_template_loaded'    // runtime
| 'compile_slot_matched'       // runtime
| 'compile_slot_missing'       // runtime
| 'compile_guard_fired'        // runtime
| 'compile_guard_halt'         // runtime
| 'compile_assembly_complete'  // runtime
```

### 11.2 Detail Contracts

**template_ingested**: `{ adminOperation: true, templateId, templateVersion, templateDigest, signedBy, ingestedBy, sectionCount, guardCount }`

**compile_template_loaded**: `{ templateId, templateVersion, templateDigest, signatureVerified: boolean, createdBy, systemGenerated?: boolean, sectionCount, guardCount }`

**compile_slot_matched**: `{ locationId, expectedSlotId, matchedItemIds: string[], itemCount }`

**compile_slot_missing**: `{ locationId?, sectionId?, expectedSlotId?, mailboxItemId?, slotId?, required?, reason: 'no_matching_fill' | 'validation_failed' | 'no_matching_location', validationReason? }`

**compile_guard_fired**: `{ guardId, guardName, severity, conditionLocationPath, conditionOperator, actionEffect, actionTarget }`

**compile_guard_halt**: `{ guardId, guardName }`

**compile_assembly_complete**: `{ templateId, templateVersion, format, itemCount, unmatchedCount, orphanedCount, validationFailureCount, guardsFired, warningCount, partial: boolean, bodyDigest }`

---

## 12. Bootstrap — Step 21 Enhancement

Construct in order: TemplateRegistryStoreImpl → TemplateValidator → TemplateVerifier → TemplateLoader → DefaultTemplateGenerator → SlotMatcher → SlotValidator (with EntityRefResolver) → GuardEvaluator → DenialMarkerInserter → FormatRenderer(s) → CompileAssembler → DeterministicRenderer → template admin route deps.

`ExternalsRuntime` unchanged. Template-signing public key loaded at bootstrap; missing key disables registry features fail-closed. Default generation still works with control-plane key.

---

## 13. CI Gates

Append after EXT-22:

| Gate | Name | Assertion |
|---:|---|---|
| CMP-01 | template contract | exports all §2 types; no Zod |
| CMP-02 | template schema | Zod accepts valid, rejects invalid |
| CMP-03 | template signature | signed passes; tampered rejected |
| CMP-04 | registry store | insert, get, latest, duplicate rejection, immutable |
| CMP-05 | ingestion route | admin auth + signed body required; invalid/duplicate rejected |
| CMP-06 | slot matching | slotId match, repeating groups, orphans |
| CMP-07 | slot validation | all 10 types, entity_ref with registry |
| CMP-08 | guard evaluation | halt/warn/auto_fix, metadata-only, cross-section |
| CMP-09 | default generator | deterministic, signed, session-only, no registry write |
| CMP-10 | deterministic renderer | identical inputs → identical output + valid signed artifact |
| CMP-11 | denial handling | inline/separate/omit + audit events |
| CMP-12 | run ledger | all 7 event types with required fields |
| CMP-13 | import law | no layer violations |
| CMP-14 | request enhancement | optional fields + preferences; old callers work |
| CMP-15 | format renderer | prose/table/raw/mixed correct; file_bundle fail-closed |
| CMP-16 | ingestion lifecycle | template_ingested emitted with adminOperation |
| CMP-17 | error taxonomy | compile errors ≠ NexusSecurityViolation |

Import law extension: `api/** → core/**`, `vanguard/** → core/compile/**`, `adapters/** → core/compile/**`, `connectors/** → core/compile/**`, `identity-ref/** → core/compile/**` all forbidden.

---

## 14. Test Scenarios

17 integration scenarios: single-agent, multi-agent, default template, missing required, invalid required, denied agent, OCT-SECURE, guard halt, guard warn, repeating group, signature tamper, unauthorized ingestion, ingestion lifecycle event, import law, default not persisted, preferences honored, file_bundle fail-closed.

Fixtures in `fixtures/compile-ref/`: template-single-agent.json, template-multi-agent.json, template-repeating-group.json, template-all-slot-types.json, template-guard-halt.json, template-guard-warning.json, template-invalid-signature.json, scenario-*.json.

---

## 15. Build Order

1. Contracts (§2) → 2. CompileRequest fields → 3. Denial codes → 4. RunEventType values → 5. Compile errors → 6. Zod schemas → 7. Signer/verifier/loader → 8. Registry store → 9. Admin route → 10. Default generator → 11. Slot matcher → 12. Slot validator + EntityRefResolver → 13. Guard evaluator → 14. Denial inserter → 15. Format renderer → 16. Compile assembler → 17. DeterministicRenderer (clean build) → 18. Compile route enhancement → 19. Bootstrap Step 21 → 20. CMP gates → 21. Fixtures + tests → 22. Full gate suite

---

## 16. Completion Criteria

All §1 files exist. All contracts exported. CompileRequest additive. Registry immutable. Admin auth + signature required for ingestion. `template_ingested` emitted. Runtime loads verify. Defaults session-only. Matching deterministic. 10 types validated. `entity_ref` uses registry. Guards metadata-only. `set_value` static V1. Missing required → partial with denial. Invalid required → halt. Guard halt → halt. Compile errors ≠ NexusSecurityViolation. Clean renderer rebuild. Signing unchanged. Route accepts selectors + preferences, no raw templates. All 7 event types emitted. API no core imports. 17 CMP gates pass. 42 existing gates green. `file_bundle` fail-closed.

---

## 17. Final Spec Statement

This spec defines the complete compile-ref build surface. Blueprint pins replace restated law. All audit items from v1–v4 are closed. No open issue-log items.

Build line-by-line from §2 through §15. Where this spec is silent, the compile-ref blueprint governs. Where this spec conflicts with blueprint, blueprint wins.

END OF SPEC
