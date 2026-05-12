// packages/orch-ref/src/ref-deterministic-planner.ts
// AMEND-spec-nexus-orch §5 — Reference Deterministic Planner
//
// SCAFFOLDING — slated for deletion in AMEND-nexus-planner-db-lexicon-v0-2-1.md
// §6.2 Commit 6. The reusable plan-assembly machinery has been
// extracted to ./plan-assembly.ts and ./condition-evaluator.ts; this
// class is now a thin tier-dispatch shell. The DbLexiconTransformerPlanner
// (Commit 4) subsumes all four production paths via tier dispatch.
//
// V1 deterministic planner. No LLM. Structured rule evaluator.
// Planner authority bounds [blueprint-K §11.4.5]:
// - MAY reject for orchestration feasibility reasons
// - MUST NOT perform authorization, risk, policy, OCT, or NXS/NVG decisions
// - Ceiling is catalog visibility only, not authorization [blueprint-K §11.7.1]

import type { Uuid, NonEmpty, Sha256Hex } from '@nexus/contracts';

import type {
  Planner,
  PlannerRequest,
  PlannerContext,
  ExecutionPlan,
  PlanRejection,
} from '@nexus/contracts';

import {
  planOctSecure,
  planFromSubTasks,
  planStandard,
  reject,
  type PlanAssemblyDeps,
} from './plan-assembly.js';

// ─── RefDeterministicPlanner ───
//
// Thin tier-dispatch shell over the extracted plan-assembly module.
// Will be deleted in Commit 6 once DbLexiconTransformerPlanner ships.

export class RefDeterministicPlanner implements Planner {
  readonly plannerType: NonEmpty = 'ref-deterministic' as NonEmpty;
  readonly plannerVersion: NonEmpty = '1.0.0' as NonEmpty;

  constructor(
    private readonly computeDigest: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid
  ) {}

  async plan(
    request: PlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    const deps: PlanAssemblyDeps = {
      computeDigest: this.computeDigest,
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
      orchestratorActorId: this.orchestratorActorId,
    };

    // §5.1 step 1: Match on tier discriminant
    switch (request.tier) {
      case 'oct_secure':
        return planOctSecure(request, context, deps);
      case 'metadata':
      case 'normal': {
        // AMEND-spec-nexus-orch §5 extension — multi-node sub-task path.
        // When the request supplies a non-empty `subTasks` array we emit
        // one node per sub-task; otherwise the legacy selectedAgentIds /
        // requiredCapabilities path produces the plan.
        if (request.subTasks && request.subTasks.length > 0) {
          return planFromSubTasks(request, context, deps);
        }
        return planStandard(request, context, deps);
      }
      default:
        return reject('malformed_request', 'Unknown visibility tier');
    }
  }
}
