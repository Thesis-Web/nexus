/**
 * Gate interface — spec §11.1
 *
 * evaluate() signature: (action, context, priorDecisions): Promise<GateResult>
 * This is the canonical signature for ALL seven gates. (CONTRA-001 closed)
 *
 * Gate 05 and Gate 06 consume context.grantTemplate! internally.
 * The orchestrator guarantees grantTemplate is set before Gate 05 or Gate 06 is invoked.
 *
 * MODULAR-008: Gate 04 is the sole computation point for ExecutionGrantTemplate law.
 */
export type {
  Gate,
  GateResult,
  PipelineContext,
} from '../types/index.js';
