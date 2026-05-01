/**
 * Workspace Reference Harness Route — AMEND-spec §6.2, §11.2
 *
 * File: packages/interfaces/api/src/routes/workspace.ts
 * Layer 7 — reference harness for workspace entry and run status.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * POST /workspace/runs — reference workspace entry
 * GET  /workspace/runs/:runId — run status summary from Run Ledger
 *
 * REFERENCE HARNESS — NOT INFRA LAW. This route is a test plug proving
 * the workspace socket, runId wire, prompt digest, ledger open event,
 * and orchestrator handoff. Production workspace implementations replace
 * it through the workspace manifest/factory surface.
 *
 * Behavior (§6.2):
 *   1. authenticate or resolve identity through configured identity provider
 *   2. generate runId = crypto.randomUUID()
 *   3. enteredAt = nowIso()
 *   4. promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))
 *   5. build WorkspaceRunRequest
 *   6. write Run Ledger event run_opened
 *   7. forward request to orchestrator socket
 *   8. return { runId, planPreview? }
 *
 * Run Ledger run_opened detail must NOT include raw prompt by default (§6.2).
 */
import type { Express } from 'express';
import type {
  RunLedgerWriter,
  IdentityProviderInterface,
  WorkspaceRunRequest,
  WorkspaceManifestRecord,
  Uuid,
  NonEmpty,
  Sha256Hex,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { randomUUID } from 'node:crypto';
import { san } from './shared.js';

// ─── DI Dependencies ───
// All service instances injected by bootstrap via API server.
// Route does NOT import core/vanguard implementations — Layer 7 import law.

export interface WorkspaceRouteDeps {
  /** RunLedgerWriter for lifecycle events. */
  runLedgerWriter: RunLedgerWriter;
  /** IdentityProviderInterface for user authentication. */
  identityProvider: IdentityProviderInterface;
  /** Loaded workspace manifest records from bootstrap. */
  workspaceSockets: readonly WorkspaceManifestRecord[];
  /** Digest function: sha256(canonicalize(obj)). Injected because route cannot import core crypto. */
  computeDigest: (obj: unknown) => Sha256Hex;
  /** Optional: forward WorkspaceRunRequest to orchestrator dispatch. */
  dispatchToOrchestrator?: (request: WorkspaceRunRequest) => Promise<unknown>;
}

// ─── Route Registration ───

export function registerWorkspaceRoutes(app: Express, deps: Partial<WorkspaceRouteDeps>): void {
  // ── POST /workspace/runs — §6.2 workspace entry ──────────────────────────

  app.post('/workspace/runs', async (req, res) => {
    if (
      !deps.runLedgerWriter ||
      !deps.identityProvider ||
      !deps.workspaceSockets ||
      !deps.computeDigest
    ) {
      res.status(501).json({ ok: false, error: 'Workspace not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const userId = body['userId'] as string | undefined;
      const principalId = body['principalId'] as string | undefined;
      const prompt = body['prompt'] as string | undefined;
      const selectedAgentIds = (body['selectedAgentIds'] ?? []) as string[];
      const planCheckbackRequested = (body['planCheckbackRequested'] ?? false) as boolean;

      // Validate required inputs
      if (!userId || !principalId || !prompt) {
        res.status(400).json({
          ok: false,
          error: 'userId, principalId, and prompt are required',
        });
        return;
      }

      // §6.2 step 1: authenticate or resolve identity
      const identity = await deps.identityProvider.resolveIdentity(userId as NonEmpty);
      if (!identity) {
        res.status(403).json({ ok: false, error: 'Identity resolution failed' });
        return;
      }

      // Resolve first enabled workspace socket
      const workspace = deps.workspaceSockets.find(ws => ws.enabled);
      if (!workspace) {
        res.status(503).json({ ok: false, error: 'No enabled workspace socket' });
        return;
      }

      // §6.2 step 2-3: generate runId, enteredAt
      const runId = randomUUID() as Uuid;
      const enteredAt = nowIso();
      const workspaceSocketId = workspace.workspaceSocketId;

      // §6.2 step 4: promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))
      const promptDigest = deps.computeDigest({
        runId,
        prompt,
        enteredAt,
        workspaceSocketId,
      });

      // §6.2 step 5: build WorkspaceRunRequest
      const request: WorkspaceRunRequest = {
        runId,
        userId: userId as NonEmpty,
        principalId: principalId as Uuid,
        authenticatedBy: deps.identityProvider.providerType as NonEmpty,
        enteredAt,
        prompt: prompt as NonEmpty,
        promptDigest,
        promptRef: null,
        selectedAgentIds: selectedAgentIds as Uuid[],
        workspaceSocketId,
        planCheckbackRequested,
      };

      // §6.2 step 6: write Run Ledger run_opened
      // Detail must NOT include raw prompt by default (§6.2).
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'run_opened',
        timestamp: enteredAt,
        actorId: null,
        detail: {
          workspaceSocketId,
          userId,
          principalId,
          authenticatedBy: deps.identityProvider.providerType,
          promptDigest,
          selectedAgentIds: request.selectedAgentIds,
          planCheckbackRequested: request.planCheckbackRequested,
        },
      });

      // §6.2 step 7: forward to orchestrator if wired
      let planPreview: unknown = null;
      if (deps.dispatchToOrchestrator) {
        planPreview = await deps.dispatchToOrchestrator(request);
      }

      // §6.2 step 8: return { runId, planPreview? }
      res.json({ ok: true, data: { runId, planPreview } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── GET /workspace/runs/:runId — §11.2 run status summary ────────────────

  app.get('/workspace/runs/:runId', async (req, res) => {
    if (!deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'Workspace not configured' });
      return;
    }

    try {
      const runId = req.params['runId'] as Uuid;
      const events = await deps.runLedgerWriter.getByRunId(runId);

      if (events.length === 0) {
        res.status(404).json({ ok: false, error: 'Run not found' });
        return;
      }

      const isClosed = events.some(e => e.eventType === 'run_closed');

      res.json({
        ok: true,
        data: {
          runId,
          eventCount: events.length,
          eventTypes: events.map(e => e.eventType),
          status: isClosed ? 'closed' : 'open',
          lastEvent: events[events.length - 1]?.eventType ?? null,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
