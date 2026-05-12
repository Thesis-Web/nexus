// packages/planners/db-lexicon/src/db-lexicon-planner.factory.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.1, log ADD-PLANNER-LEXICON-002.
//
// Factory class registered with the PlannerFactoryRegistry. Bootstrap
// step 17b constructs this factory AFTER step 18a has loaded the
// signed lexicon fixtures (row 9 ratification — fixture load is
// bootstrap-step ownership, NOT factory ownership).
//
// The factory's `create()` is called by step 22c when the active
// orchestrator manifest selects `plannerType: 'db-lexicon-transformer-v0'`.

import type {
  OrchestratorManifestRecord,
  Planner,
  PlannerFactory,
  NonEmpty,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { DbLexiconTransformerPlanner } from './db-lexicon-planner.js';
import type { LexiconTablesV1 } from './internal/types.js';

export class DbLexiconTransformerPlannerFactory implements PlannerFactory {
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly factoryVersion: NonEmpty = '0.1.0' as NonEmpty;

  constructor(
    private readonly lexiconTables: LexiconTablesV1,
    private readonly computeDigest: (obj: unknown) => Sha256Hex
  ) {}

  async create(record: OrchestratorManifestRecord): Promise<Planner> {
    // Factory does NOT re-load or re-verify fixtures — bootstrap step
    // 18a is the single owner of fixture I/O (row 9 ratification).
    // The factory only constructs the planner with pre-loaded tables.
    return new DbLexiconTransformerPlanner(
      this.lexiconTables,
      this.computeDigest,
      record.orchestratorActorId as Uuid
    );
  }
}
