/**
 * Compile Error Taxonomy — AMEND-spec-nexus-compile §7
 *
 * File: packages/core/src/compile/compile-errors.ts
 * Layer 1 — compile-domain error classes.
 *
 * Do NOT use NexusSecurityViolation for compile assembly failures.
 * These are compile-domain errors with denial codes for audit mapping.
 */

import type { NonEmpty } from '@nexus/contracts';

// ─── CompileTemplateError ───
// Template loading, verification, or validation failure.
// Used by: TemplateVerifier, TemplateLoader, TemplateValidator.

export class CompileTemplateError extends Error {
  readonly denialCode: string;

  constructor(denialCode: string, message: string) {
    super(message);
    this.name = 'CompileTemplateError';
    this.denialCode = denialCode;
  }
}

// ─── CompileAssemblyError ───
// Assembly-phase failure (slot validation, fill type mismatch, incomplete).
// Used by: CompileAssembler, SlotValidator, FormatRenderer.

export class CompileAssemblyError extends Error {
  readonly denialCode: string;

  constructor(denialCode: string, message: string) {
    super(message);
    this.name = 'CompileAssemblyError';
    this.denialCode = denialCode;
  }
}

// ─── CompileGuardHaltError ───
// Guard evaluation resulted in a halt severity — assembly must stop.
// Extends CompileAssemblyError so callers can catch broadly.
// Used by: GuardEvaluator (thrown), CompileAssembler (caught/rethrown),
//          DeterministicRenderer (caught for ledger events before re-throw).

export class CompileGuardHaltError extends CompileAssemblyError {
  readonly guardId: NonEmpty;
  readonly guardName: NonEmpty;
  readonly conditionLocationPath: string;
  readonly conditionOperator: string;
  readonly actionTarget: string;

  constructor(
    guardId: NonEmpty,
    guardName: NonEmpty,
    conditionLocationPath: string,
    conditionOperator: string,
    actionTarget: string
  ) {
    super('guard_halt', `Compile guard halt: guard '${guardName}' (${guardId})`);
    this.name = 'CompileGuardHaltError';
    this.guardId = guardId;
    this.guardName = guardName;
    this.conditionLocationPath = conditionLocationPath;
    this.conditionOperator = conditionOperator;
    this.actionTarget = actionTarget;
  }
}
