/**
 * Slot Validator — AMEND-spec-nexus-compile §8.3
 *
 * File: packages/core/src/compile/slot-validator.ts
 * Layer 1 — validates fill values against slot type expectations.
 *
 * 10 slot types validated per [blueprint §8.3].
 * V1: structural validation only [blueprint §8.4].
 * entity_ref uses SlotType.registry to select owning registry
 * via injected EntityRefResolver.
 */
import type { CompileLocation, SlotTypeName, EntityRegistryName, NonEmpty } from '@nexus/contracts';

// ─── Result Types ───

export interface SlotValidationError {
  locationId: NonEmpty;
  slotType: SlotTypeName;
  reason: string;
}

export interface SlotValidationResult {
  valid: boolean;
  errors: SlotValidationError[];
}

// ─── EntityRefResolver — resolves entity references against registries ───

export interface EntityRefResolver {
  resolve(registry: EntityRegistryName, entityId: NonEmpty): Promise<boolean>;
}

// ─── Interface ───

export interface SlotValidator {
  validate(location: CompileLocation, fillValue: unknown): Promise<SlotValidationResult>;
}

// ─── Implementation ───

export class SlotValidatorImpl implements SlotValidator {
  private readonly entityRefResolver: EntityRefResolver;

  constructor(entityRefResolver: EntityRefResolver) {
    this.entityRefResolver = entityRefResolver;
  }

  async validate(location: CompileLocation, fillValue: unknown): Promise<SlotValidationResult> {
    const errors: SlotValidationError[] = [];
    const slotType = location.slotType;

    switch (slotType.type) {
      case 'string':
        this.validateString(location, fillValue, errors);
        break;

      case 'number':
        this.validateNumber(location, fillValue, errors);
        break;

      case 'date':
        this.validateDate(location, fillValue, errors);
        break;

      case 'enum':
        this.validateEnum(location, fillValue, errors);
        break;

      case 'entity_ref':
        await this.validateEntityRef(location, fillValue, errors);
        break;

      case 'prose':
        this.validateProse(location, fillValue, errors);
        break;

      case 'table':
        this.validateTable(location, fillValue, errors);
        break;

      case 'repeating_group':
        this.validateRepeatingGroup(location, fillValue, errors);
        break;

      case 'asset_ref':
        this.validateAssetRef(location, fillValue, errors);
        break;

      case 'computed':
        // V1: computed slots are validated at template ingestion (computeFn + same_agent).
        // At assembly time, the fill value is accepted as-is.
        break;
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── Type-specific validators ───

  private validateString(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'string',
        reason: `Expected string, got ${typeof fillValue}`,
      });
      return;
    }
    if (
      location.slotType.maxLength !== undefined &&
      fillValue.length > location.slotType.maxLength
    ) {
      errors.push({
        locationId: location.locationId,
        slotType: 'string',
        reason: `String length ${fillValue.length} exceeds maxLength ${location.slotType.maxLength}`,
      });
    }
  }

  private validateNumber(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    if (typeof fillValue !== 'number' || Number.isNaN(fillValue)) {
      errors.push({
        locationId: location.locationId,
        slotType: 'number',
        reason: `Expected number, got ${typeof fillValue}`,
      });
      return;
    }
    if (location.slotType.min !== undefined && fillValue < location.slotType.min) {
      errors.push({
        locationId: location.locationId,
        slotType: 'number',
        reason: `Value ${fillValue} below min ${location.slotType.min}`,
      });
    }
    if (location.slotType.max !== undefined && fillValue > location.slotType.max) {
      errors.push({
        locationId: location.locationId,
        slotType: 'number',
        reason: `Value ${fillValue} above max ${location.slotType.max}`,
      });
    }
  }

  private validateDate(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'date',
        reason: `Expected date string, got ${typeof fillValue}`,
      });
      return;
    }
    const parsed = Date.parse(fillValue);
    if (Number.isNaN(parsed)) {
      errors.push({
        locationId: location.locationId,
        slotType: 'date',
        reason: 'Invalid date format',
      });
    }
  }

  private validateEnum(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'enum',
        reason: `Expected string for enum, got ${typeof fillValue}`,
      });
      return;
    }
    const allowedValues = location.slotType.values;
    if (allowedValues !== undefined && !allowedValues.includes(fillValue)) {
      errors.push({
        locationId: location.locationId,
        slotType: 'enum',
        reason: `Value '${fillValue}' not in allowed values: ${allowedValues.join(', ')}`,
      });
    }
  }

  private async validateEntityRef(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): Promise<void> {
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'entity_ref',
        reason: `Expected string entity ID, got ${typeof fillValue}`,
      });
      return;
    }
    const registry = location.slotType.registry;
    if (registry === undefined) {
      errors.push({
        locationId: location.locationId,
        slotType: 'entity_ref',
        reason: 'entity_ref slot missing registry specification',
      });
      return;
    }
    const exists = await this.entityRefResolver.resolve(registry, fillValue as NonEmpty);
    if (!exists) {
      errors.push({
        locationId: location.locationId,
        slotType: 'entity_ref',
        reason: `Entity '${fillValue}' not found in '${registry}' registry`,
      });
    }
  }

  private validateProse(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    // V1: structural only — must be a string [blueprint §8.4]
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'prose',
        reason: `Expected string for prose, got ${typeof fillValue}`,
      });
      return;
    }
    if (
      location.slotType.maxLength !== undefined &&
      fillValue.length > location.slotType.maxLength
    ) {
      errors.push({
        locationId: location.locationId,
        slotType: 'prose',
        reason: `Prose length ${fillValue.length} exceeds maxLength ${location.slotType.maxLength}`,
      });
    }
  }

  private validateTable(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    // V1: table can be a string (formatted) or structured object
    if (typeof fillValue !== 'string' && (typeof fillValue !== 'object' || fillValue === null)) {
      errors.push({
        locationId: location.locationId,
        slotType: 'table',
        reason: `Expected string or object for table, got ${typeof fillValue}`,
      });
    }
  }

  private validateRepeatingGroup(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    // V1: repeating_group fill should be an array
    if (!Array.isArray(fillValue)) {
      errors.push({
        locationId: location.locationId,
        slotType: 'repeating_group',
        reason: `Expected array for repeating_group, got ${typeof fillValue}`,
      });
    }
  }

  private validateAssetRef(
    location: CompileLocation,
    fillValue: unknown,
    errors: SlotValidationError[]
  ): void {
    if (typeof fillValue !== 'string') {
      errors.push({
        locationId: location.locationId,
        slotType: 'asset_ref',
        reason: `Expected string reference for asset_ref, got ${typeof fillValue}`,
      });
    }
  }
}
