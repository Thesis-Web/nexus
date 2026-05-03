// packages/orch-ref/src/index.ts
// AMEND-spec-nexus-orch §1.2 — Orch-Ref Barrel
// External reference — Reference Orchestrator package.
//
// Imports @nexus/contracts ONLY [ORCH-18].

export {
  RefDeterministicPlanner,
  evaluateCondition,
  determineNodeType,
} from './ref-deterministic-planner.js';

export type { ConditionEvalResult, NodeTypeResult } from './ref-deterministic-planner.js';

export { RefDagExecutor, classifyDagCompletion } from './dag-executor.js';

export type {
  DagExecutorDeps,
  NodeDispatchResult,
  DagExecutor,
  DagExecutionResult,
  PartialCompletionConfig,
  DagClassificationInput,
  DagClassification,
} from './dag-executor.js';

export { validateExecutionPlan } from './validate-plan.js';

export type { PlanValidationResult } from './validate-plan.js';

export { PlanAmendmentHandler, validateMerge, mergePlans } from './plan-amendment.js';

export type { AmendmentDeps, AmendmentResult, MergeValidationResult } from './plan-amendment.js';

export { RefRunCoordinator } from './run-coordinator.js';

export type { DelegationScope, RunCoordinatorDeps, RunCoordinator } from './run-coordinator.js';
