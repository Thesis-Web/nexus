/**
 * Orchestrator Reference Harness Route — AMEND-spec §6.3, §11.2
 *
 * File: packages/interfaces/api/src/routes/orchestrator.ts
 * Layer 7 — reference harness for orchestrator dispatch.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * POST /orchestrator/dispatch — reference orchestrator dispatch
 *
 * REFERENCE HARNESS — NOT INFRA LAW. This route is a test plug proving
 * the orchestrator socket, plan preview contract, expected output slot
 * declaration, ledger event, and dispatch wire. Production orchestrator
 * implementations replace it through the orchestrator manifest/factory
 * surface.
 *
 * Nexus infra validates, records, and routes declarations.
 * It does NOT generate orchestration intelligence (§6.3).
 *
 * Behavior (§6.3):
 *   1. load enabled orchestrator socket from manifest
 *   2. validate orchestrator actor registration if registry available
 *   3. create OrchestratorPlanPreview
 *   4. require each selected task to carry expectedOutputSlots
 *   5. write Run Ledger event orchestrator_dispatched
 *   6. return plan preview
 */
import type { Express } from 'express';
import type {
  RunLedgerWriter,
  WorkspaceRunRequest,
  OrchestratorManifestRecord,
  OrchestratorPlanPreview,
  OrchestratorSelectedAgent,
  Orchestrator,
  Uuid,
  NonEmpty,
  Sha256Hex,
} from '@nexus/contracts';
import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';
import { randomUUID } from 'node:crypto';
import { san } from './shared.js';

// ─── DI Dependencies ───

export interface OrchestratorRouteDeps {
  /** RunLedgerWriter for lifecycle events. */
  runLedgerWriter: RunLedgerWriter;
  /** Loaded orchestrator manifest records from bootstrap. */
  orchestratorSockets: readonly OrchestratorManifestRecord[];
  /** Digest function: sha256(canonicalize(obj)). Injected — Layer 7 cannot import core crypto. */
  computeDigest: (obj: unknown) => Sha256Hex;
  /** Injected Orchestrator socket — for cancel and DAG-based dispatch [ORCH-23]. */
  orchestrator: Orchestrator | null;
}

// ─── Route Registration ───

export function registerOrchestratorRoutes(
  app: Express,
  deps: Partial<OrchestratorRouteDeps>
): void {
  app.post('/orchestrator/dispatch', async (req, res) => {
    if (!deps.runLedgerWriter || !deps.orchestratorSockets || !deps.computeDigest) {
      res.status(501).json({ ok: false, error: 'Orchestrator not configured' });
      return;
    }

    try {
      const request = req.body as WorkspaceRunRequest;

      // Validate required fields on incoming WorkspaceRunRequest
      if (!request.runId || !request.prompt) {
        res.status(400).json({
          ok: false,
          error: 'Valid WorkspaceRunRequest required (runId, prompt)',
        });
        return;
      }

      // §6.3 step 1: load enabled orchestrator socket from manifest
      const orchestrator = deps.orchestratorSockets.find(o => o.enabled);
      if (!orchestrator) {
        res.status(503).json({ ok: false, error: 'No enabled orchestrator socket' });
        return;
      }

      // §6.3 step 3: create OrchestratorPlanPreview (reference deterministic)
      // §6.3 step 4: each selected task must carry expectedOutputSlots
      const selectedAgents: OrchestratorSelectedAgent[] = (request.selectedAgentIds ?? []).map(
        agentId => ({
          agentId,
          taskId: randomUUID() as Uuid,
          taskSummary: `Reference task for agent ${agentId}` as NonEmpty,
          requiresNvg: false,
          requiresNxs: false,
          estimatedRisk: EVIDENCE_SENTINEL,
          expectedOutputSlots: ['default' as NonEmpty],
        })
      );

      // §3.3.1: planDigest = sha256(canonicalize({
      //   runId, orchestratorSocketId, orchestratorActorId,
      //   plannerMode, selectedAgents, requiresUserApproval
      // }))
      const planDigest = deps.computeDigest({
        runId: request.runId,
        orchestratorSocketId: orchestrator.orchestratorSocketId,
        orchestratorActorId: orchestrator.orchestratorActorId,
        plannerMode: 'deterministic',
        selectedAgents,
        requiresUserApproval: false,
      });

      const planPreview: OrchestratorPlanPreview = {
        runId: request.runId,
        orchestratorSocketId: orchestrator.orchestratorSocketId,
        orchestratorActorId: orchestrator.orchestratorActorId,
        plannerMode: 'deterministic',
        selectedAgents,
        requiresUserApproval: false,
        planDigest,
        plan: null, // legacy flat preview — no DAG plan in ref harness route
        rejection: null, // populated by Commit 5 coordinator wiring
      };

      // §6.3 step 5: write Run Ledger orchestrator_dispatched
      await deps.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'orchestrator_dispatched',
        timestamp: nowIso(),
        actorId: orchestrator.orchestratorActorId as string | null,
        detail: {
          orchestratorSocketId: orchestrator.orchestratorSocketId,
          orchestratorActorId: orchestrator.orchestratorActorId,
          plannerMode: planPreview.plannerMode,
          planDigest: planPreview.planDigest,
          selectedAgentCount: selectedAgents.length,
          selectedAgentIds: selectedAgents.map(a => a.agentId),
          taskIds: selectedAgents.map(a => a.taskId),
          expectedOutputSlots: selectedAgents.map(a => ({
            agentId: a.agentId,
            expectedOutputSlots: a.expectedOutputSlots,
          })),
          outputSlotPolicy: orchestrator.outputSlotPolicy,
        },
      });

      res.json({ ok: true, data: planPreview });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── POST /orchestrator/cancel — AMEND-spec-nexus-orch §10.4, ORCH-23 ───
  // Cancel route receives injected Orchestrator socket through DI.
  // Route MUST NOT import @nexus/orch-ref.
  // Route MUST NOT inspect or mutate RunDagState directly.
  app.post('/orchestrator/cancel', async (req, res) => {
    if (!deps.orchestrator) {
      res.status(501).json({ ok: false, error: 'Orchestrator not configured' });
      return;
    }

    try {
      const { runId } = req.body as { runId: Uuid };

      if (!runId) {
        res.status(400).json({ ok: false, error: 'runId required' });
        return;
      }

      await deps.orchestrator.cancel(runId);
      res.json({ ok: true, cancelled: true, runId });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
