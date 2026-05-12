// packages/planners/db-lexicon/src/index.ts
// @nexus/planner-db-lexicon — DB lexicon transformer planner.
//
// Reference Planner implementation registered under
// plannerType 'db-lexicon-transformer-v0' per
// AMEND-nexus-planner-db-lexicon-v0-2-1.md.
//
// SKELETON — populated by §6.2 Commit 4:
//   - DbLexiconTransformerPlanner (implements Planner + PlannerTraceReader)
//   - DbLexiconTransformerPlannerFactory (implements PlannerFactory)
//   - internal/lexical-resolver.ts (own tokenizer; NOT LexicalNormalizer)
//   - internal/preflight.ts (Branch 3 feasibility check)
//   - internal/lexical-decomposition.ts (Branch 4 Layer A-E)
//   - internal/fixture-loader.ts (signed JSONL load — used by bootstrap step 18a)
//
// V1 allowed imports (§6.5):
//   @nexus/contracts, @nexus/runtime-utils, @nexus/orch-ref
//
// V1 forbidden imports (enforced by ci:gate PLANNER-LEXICON-05):
//   @nexus/core, @nexus/vanguard, @nexus/identity-ref,
//   @nexus/adapters/*, @nexus/connectors/*, @nexus/interfaces/*,
//   @nexus/workspace-ref
export {};
