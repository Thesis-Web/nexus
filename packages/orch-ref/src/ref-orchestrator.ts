// packages/orch-ref/src/ref-orchestrator.ts
// AMEND-spec-nexus-orch §9 — Reference Orchestrator Assembly
// External reference — imports @nexus/contracts ONLY.
//
// Two-level unpluggability [blueprint-K §11.1]:
// 1. Swap whole orch: implement Orchestrator socket, register new OrchestratorFactory.
// 2. Swap planner only: implement Planner interface, register new PlannerFactory.

import type {
  Orchestrator,
  OrchestratorPlanPreview,
  WorkspaceRunRequest,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';

import type { RunCoordinator } from './run-coordinator.js';

export class RefOrchestrator implements Orchestrator {
  readonly orchestratorSocketId: NonEmpty;
  readonly orchestratorVersion: NonEmpty;

  constructor(
    socketId: NonEmpty,
    version: NonEmpty,
    private readonly coordinator: RunCoordinator
  ) {
    this.orchestratorSocketId = socketId;
    this.orchestratorVersion = version;
  }

  async dispatch(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview> {
    return this.coordinator.handleRun(request);
  }

  async cancel(runId: Uuid): Promise<void> {
    return this.coordinator.cancelRun(runId);
  }
}
