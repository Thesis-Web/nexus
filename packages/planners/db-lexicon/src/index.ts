// packages/planners/db-lexicon/src/index.ts
// @nexus/planner-db-lexicon — DB lexicon transformer planner.
//
// Reference Planner implementation registered under
// plannerType 'db-lexicon-transformer-v0' per
// AMEND-nexus-planner-db-lexicon-v0-2-1.md.
//
// V1 allowed imports (§6.5):
//   @nexus/contracts, @nexus/runtime-utils, @nexus/orch-ref
//
// V1 forbidden imports (enforced by ci:gate PLANNER-LEXICON-05):
//   @nexus/core, @nexus/vanguard, @nexus/identity-ref,
//   @nexus/adapters/*, @nexus/connectors/*, @nexus/interfaces/*,
//   @nexus/workspace-ref

export { DbLexiconTransformerPlanner } from './db-lexicon-planner.js';
export type { PlannerCheckbackReader } from './db-lexicon-planner.js';

export { DbLexiconTransformerPlannerFactory } from './db-lexicon-planner.factory.js';

export { loadLexiconFixtures } from './internal/fixture-loader.js';
export type { LoadLexiconOptions } from './internal/fixture-loader.js';

export type {
  LexiconTablesV1,
  PlannerLexicalTerm,
  PlannerAliasRule,
  PlannerTaskIntent,
  PlannerTaskCapability,
  PlannerTargetCatalog,
  PlannerWorkflowTemplate,
  PlannerWorkflowNode,
  PlannerWorkflowEdge,
  PhraseClass,
  AliasStatus,
  WorkflowNodeKind,
  WorkflowEdgeType,
  ResourceScope,
  LexiconFixtureHeader,
} from './internal/types.js';
