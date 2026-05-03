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
