/**
 * Guard Evaluator — AMEND-spec-nexus-compile §8.4
 *
 * File: packages/core/src/compile/guard-evaluator.ts
 * Layer 1 — evaluates template guards against match result metadata.
 *
 * Guards read METADATA only — never prose content [blueprint §7.4].
 * set_value is static-only in V1 [blueprint §7 + v4 §11.4].
 * Evaluation order: guards processed in template.guards array order.
 * Halt guard stops evaluation immediately.
 */
import type {
  CompileTemplate,
  CompileGuard,
  GuardCondition,
  GuardAction,
  MailboxItem,
  NonEmpty,
} from '@nexus/contracts';
import type { SlotMatchResult } from './slot-matcher.js';

// ─── Result Types ───

export interface FiredGuard {
  guardId: NonEmpty;
  guardName: string;
  severity: CompileGuard['severity'];
  condition: GuardCondition;
  action: GuardAction;
}

export interface GuardModification {
  targetLocationPath: string;
  effect: GuardAction['effect'];
  value?: string | number | boolean;
  sourceGuardId: NonEmpty;
}

export interface GuardWarning {
  locationPath: string;
  message: string;
  sourceGuardId: NonEmpty;
}

export interface GuardEvaluationResult {
  passed: boolean;
  firedGuards: FiredGuard[];
  haltGuard: FiredGuard | null;
  modifications: GuardModification[];
  warnings: GuardWarning[];
}

// ─── Fill Metadata (guards read this, not content) ───

interface FillMetadata {
  filled: boolean;
  itemCount: number;
}

// ─── Interface ───

export interface GuardEvaluator {
  evaluate(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    items: MailboxItem[]
  ): GuardEvaluationResult;
}

// ─── Implementation ───

export class GuardEvaluatorImpl implements GuardEvaluator {
  evaluate(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    _items: MailboxItem[]
  ): GuardEvaluationResult {
    // Build fill metadata index keyed by location path
    const metadataIndex = this.buildFillMetadataIndex(template, matchResult);

    const firedGuards: FiredGuard[] = [];
    const modifications: GuardModification[] = [];
    const warnings: GuardWarning[] = [];

    for (const guard of template.guards) {
      const conditionMet = this.evaluateCondition(guard.when, metadataIndex);

      if (!conditionMet) continue;

      const fired: FiredGuard = {
        guardId: guard.guardId,
        guardName: guard.name,
        severity: guard.severity,
        condition: guard.when,
        action: guard.then,
      };
      firedGuards.push(fired);

      switch (guard.severity) {
        case 'halt':
          // Halt stops evaluation immediately
          return {
            passed: false,
            firedGuards,
            haltGuard: fired,
            modifications,
            warnings,
          };

        case 'auto_fix':
          modifications.push({
            targetLocationPath: guard.then.targetLocationPath,
            effect: guard.then.effect,
            ...(guard.then.value !== undefined ? { value: guard.then.value } : {}),
            sourceGuardId: guard.guardId,
          });
          break;

        case 'warn_and_mark':
          warnings.push({
            locationPath: guard.then.targetLocationPath,
            message: `Guard '${guard.name}' warning: ${guard.then.effect} on ${guard.then.targetLocationPath}`,
            sourceGuardId: guard.guardId,
          });
          break;
      }
    }

    return {
      passed: true,
      firedGuards,
      haltGuard: null,
      modifications,
      warnings,
    };
  }

  // ─── Private ───

  /**
   * Build metadata index: path → FillMetadata.
   * Path format: sectionId.locationId (matches guard locationPath).
   */
  private buildFillMetadataIndex(
    template: CompileTemplate,
    matchResult: SlotMatchResult
  ): Map<string, FillMetadata> {
    const index = new Map<string, FillMetadata>();

    for (const section of template.sections) {
      for (const location of section.locations) {
        const path = `${section.sectionId}.${location.locationId}`;
        const match = matchResult.matched.get(location.locationId);

        index.set(path, {
          filled: match !== undefined && match.items.length > 0,
          itemCount: match !== undefined ? match.items.length : 0,
        });
      }
    }

    return index;
  }

  /**
   * Evaluate a single guard condition against the metadata index.
   */
  private evaluateCondition(condition: GuardCondition, index: Map<string, FillMetadata>): boolean {
    // 'any_location' wildcard — match if ANY location satisfies
    if (condition.locationPath === 'any_location') {
      for (const metadata of index.values()) {
        if (this.evaluateOperator(condition.operator, metadata, condition.value)) {
          return true;
        }
      }
      return false;
    }

    // Normal path lookup
    const metadata = index.get(condition.locationPath);
    if (metadata === undefined) {
      // Path doesn't resolve — condition is false (guard doesn't fire)
      return false;
    }

    return this.evaluateOperator(condition.operator, metadata, condition.value);
  }

  /**
   * Evaluate a single operator against fill metadata.
   */
  private evaluateOperator(
    operator: GuardCondition['operator'],
    metadata: FillMetadata,
    conditionValue: string | number | boolean | undefined
  ): boolean {
    switch (operator) {
      case 'is_empty':
        return !metadata.filled;

      case 'is_filled':
        return metadata.filled;

      case 'count_gt':
        return typeof conditionValue === 'number' && metadata.itemCount > conditionValue;

      case 'count_lt':
        return typeof conditionValue === 'number' && metadata.itemCount < conditionValue;

      // Comparison operators use itemCount as the comparable metadata value
      case '==':
        return metadata.itemCount === conditionValue;
      case '!=':
        return metadata.itemCount !== conditionValue;
      case '>':
        return typeof conditionValue === 'number' && metadata.itemCount > conditionValue;
      case '<':
        return typeof conditionValue === 'number' && metadata.itemCount < conditionValue;
      case '>=':
        return typeof conditionValue === 'number' && metadata.itemCount >= conditionValue;
      case '<=':
        return typeof conditionValue === 'number' && metadata.itemCount <= conditionValue;

      default:
        return false;
    }
  }
}
