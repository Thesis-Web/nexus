/**
 * Template Validation Schemas — AMEND-spec-nexus-compile §4
 *
 * File: packages/core/src/compile/template-schemas.ts
 * Layer 1 — Zod schemas for CompileTemplate ingestion validation.
 *
 * No Zod in contracts — schemas live here in core.
 * API routes never import this file directly — use TemplateValidator
 * interface injected via bootstrap.
 *
 * Structural validation (§4.3): no duplicate IDs, guard paths resolve,
 * file_bundle rejected for V1 registry templates.
 */
import { z } from 'zod';
import type { CompileTemplate, NonEmpty } from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import { CompileTemplateError } from './compile-errors.js';

// ─── Interface [spec §4.1] ───

export interface TemplateValidator {
  validateForIngestion(template: unknown): CompileTemplate;
}

// ─── Enum Schemas ───

export const ContentGranularitySchema = z.enum(['block', 'paragraph', 'sentence', 'inline']);
export const SlotTypeNameSchema = z.enum([
  'string',
  'number',
  'date',
  'enum',
  'entity_ref',
  'prose',
  'table',
  'repeating_group',
  'asset_ref',
  'computed',
]);
export const CompileFormatSchema = z.enum(['prose', 'table', 'raw', 'mixed', 'file_bundle']);
export const DenialHandlingSchema = z.enum(['inline', 'separate_section', 'omit']);
export const EntityRegistryNameSchema = z.enum([
  'actor',
  'principal',
  'system',
  'connector',
  'template',
]);

// ─── SlotType + CompileLocation (circular ref handled by z.lazy) ───

export const SlotTypeSchema: z.ZodType = z.lazy(() =>
  z
    .object({
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
    })
    .superRefine((data, ctx) => {
      if (data.type === 'prose' && !data.granularity)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'prose requires granularity' });
      if (data.type === 'enum' && (!data.values || data.values.length === 0))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'enum requires values' });
      if (
        data.type === 'repeating_group' &&
        (!data.childLocations || data.childLocations.length === 0)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'repeating_group requires childLocations',
        });
      if (data.type === 'computed' && !data.computeFn)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'computed requires computeFn' });
      if (data.type === 'computed' && data.computeScope !== 'same_agent')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'V1: computed requires same_agent',
        });
      if (data.type === 'entity_ref' && !data.registry)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'entity_ref requires registry',
        });
    })
);

export const CompileLocationSchema: z.ZodType = z.object({
  locationId: z.string().min(1),
  position: z.number().int().nonnegative(),
  assignedAgentId: z.string().uuid(),
  expectedSlotId: z.string().min(1),
  slotType: SlotTypeSchema,
  required: z.boolean(),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
});

// ─── Section, Guard, Template ───

export const CompileSectionSchema = z.object({
  sectionId: z.string().min(1),
  position: z.number().int().nonnegative(),
  title: z.string(),
  assignedAgentId: z.string().uuid(),
  expectedContentType: z.enum(['prose', 'table', 'data', 'file', 'mixed']),
  locations: z.array(CompileLocationSchema).min(1),
  formatHint: z.string().optional(),
});

export const GuardConditionSchema = z.object({
  locationPath: z.string().min(1),
  operator: z.enum([
    '==',
    '!=',
    '>',
    '<',
    '>=',
    '<=',
    'is_empty',
    'is_filled',
    'count_gt',
    'count_lt',
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const GuardActionSchema = z.object({
  targetLocationPath: z.string().min(1),
  effect: z.enum(['set_required', 'set_value', 'block_section', 'add_warning']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const CompileGuardSchema = z.object({
  guardId: z.string().min(1),
  name: z.string().min(1),
  when: GuardConditionSchema,
  then: GuardActionSchema,
  severity: z.enum(['halt', 'warn_and_mark', 'auto_fix']),
});

export const CompileTemplateSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  format: CompileFormatSchema,
  sections: z.array(CompileSectionSchema).min(1),
  guards: z.array(CompileGuardSchema),
  denialHandling: DenialHandlingSchema,
  createdAt: z.string().min(1),
  createdBy: z.enum(['user', 'orchestrator', 'contract_designer', 'default']),
  templateDigest: z.string().length(64),
  signature: z.string().min(1),
});

// ─── Structural Validation (§4.3) ───

function validateStructure(template: CompileTemplate): void {
  const sectionIds = new Set<string>();
  const locationIds = new Set<string>();

  // Collect all location IDs recursively (handles repeating_group childLocations)
  function collectLocationIds(locations: CompileTemplate['sections'][number]['locations']): void {
    for (const loc of locations) {
      if (locationIds.has(loc.locationId)) {
        throw new CompileTemplateError(
          DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
          `Duplicate locationId: '${loc.locationId}'`
        );
      }
      locationIds.add(loc.locationId);
      if (loc.slotType.type === 'repeating_group' && loc.slotType.childLocations) {
        collectLocationIds(
          loc.slotType.childLocations as CompileTemplate['sections'][number]['locations']
        );
      }
    }
  }

  // Check unique sectionIds and locationIds
  for (const section of template.sections) {
    if (sectionIds.has(section.sectionId)) {
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
        `Duplicate sectionId: '${section.sectionId}'`
      );
    }
    sectionIds.add(section.sectionId);
    collectLocationIds(section.locations);
  }

  // Check unique guardIds
  const guardIds = new Set<string>();
  for (const guard of template.guards) {
    if (guardIds.has(guard.guardId)) {
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
        `Duplicate guardId: '${guard.guardId}'`
      );
    }
    guardIds.add(guard.guardId);
  }

  // Validate guard paths resolve against template
  for (const guard of template.guards) {
    validateGuardPath(guard.when.locationPath, sectionIds, locationIds, 'when.locationPath');
    validateGuardPath(
      guard.then.targetLocationPath,
      sectionIds,
      locationIds,
      'then.targetLocationPath'
    );
  }

  // file_bundle rejected at ingestion for V1 registry templates [spec §4.3]
  if (template.format === 'file_bundle') {
    throw new CompileTemplateError(
      DENIAL_CODE.FILE_BUNDLE_DENIED,
      'file_bundle format is not permitted for V1 registry templates'
    );
  }
}

function validateGuardPath(
  path: string,
  sectionIds: Set<string>,
  locationIds: Set<string>,
  fieldName: string
): void {
  // 'any_location' is a valid wildcard [spec §4.3]
  if (path === 'any_location') return;

  const segments = path.split('.');
  if (segments.length === 0 || segments[0] === '') {
    throw new CompileTemplateError(
      DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
      `Guard ${fieldName} is empty`
    );
  }

  // First segment must be a sectionId
  if (!sectionIds.has(segments[0]!)) {
    throw new CompileTemplateError(
      DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
      `Guard ${fieldName} '${path}': first segment '${segments[0]}' is not a valid sectionId`
    );
  }

  // Subsequent segments must be locationIds
  for (let i = 1; i < segments.length; i++) {
    if (!locationIds.has(segments[i]!)) {
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
        `Guard ${fieldName} '${path}': segment '${segments[i]}' is not a valid locationId`
      );
    }
  }
}

// ─── TemplateValidator Implementation ───

export class TemplateValidatorImpl implements TemplateValidator {
  validateForIngestion(template: unknown): CompileTemplate {
    // Phase 1: Zod structural parse
    const parseResult = CompileTemplateSchema.safeParse(template);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_VALIDATION_FAILED,
        `Template validation failed: ${issues.join('; ')}`
      );
    }

    const validated = parseResult.data as CompileTemplate;

    // Phase 2: Structural validation (§4.3)
    validateStructure(validated);

    return validated;
  }
}
