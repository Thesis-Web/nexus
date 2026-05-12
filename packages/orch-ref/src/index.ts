// packages/orch-ref/src/index.ts
// AMEND-spec-nexus-orch §1.2 — Orch-Ref Barrel
// External reference — Reference Orchestrator package.
//
// Imports @nexus/contracts ONLY [ORCH-18].

// RefDeterministicPlanner deleted in Commit 6 of
// AMEND-nexus-planner-db-lexicon-v0-2-1.md. The reusable machinery lives
// in `./plan-assembly.js` (re-exported below); the production planner is
// `@nexus/planner-db-lexicon`'s `DbLexiconTransformerPlanner`.

export { evaluateCondition, determineNodeType } from './condition-evaluator.js';

export type { ConditionEvalResult, NodeTypeResult } from './condition-evaluator.js';

// Plan-assembly primitives — extracted per
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 1. Consumed
// directly by RefDeterministicPlanner today and by
// DbLexiconTransformerPlanner from Commit 4 onward.
export {
  planOctSecure,
  planFromSubTasks,
  planStandard,
  hasCycle,
  compareEdges,
  reject,
  buildNodeFromSubTask,
  validateConditionSpec,
  isVisible,
  findAlternatives,
  buildEdges,
  buildPlan,
  buildTaskSummary,
  NODE_TIMEOUT_MS,
} from './plan-assembly.js';

export type { PlanAssemblyDeps } from './plan-assembly.js';

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

export type {
  DelegationScope,
  RunCoordinatorDeps,
  RunCoordinator,
  RunCoordinatorPerRunDeps,
} from './run-coordinator.js';

export { RefOrchestrator } from './ref-orchestrator.js';
