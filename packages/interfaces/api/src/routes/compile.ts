/**
 * Compile Reference Harness Route — AMEND-spec §6.8, §10
 *
 * File: packages/interfaces/api/src/routes/compile.ts
 * Layer 7 — reference harness for mailbox-to-compile wire.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * POST /compile/runs/:runId — invoke compile for run
 *
 * REFERENCE HARNESS — NOT INFRA LAW. This route exists so the full
 * compile → compile-return wire can be tested end-to-end.
 *
 * Behavior (§6.8):
 *   1. outputContract = outputCollector.buildOutputContract(runId)
 *   2. compiler = selected enabled compiler from manifest
 *   3. items = mailboxService.listEligibleForCompile(mailboxId, runId)
 *   4. compileRequest = { runId, compilerSocketId, mailboxId, outputContractId, requestedAt }
 *   5. artifact = compileService.compile(compileRequest, outputContract, items)
 *   6. endpoint = socketRegistry.resolveReturnEndpointForRun(runId)
 *   7. ack = compileReturnDispatcher.dispatch({ runId, endpoint, artifact, sentAt })
 *   8. mark mailbox items consumed only after successful compile-return acceptance
 *
 * §10 Enhancement (AMEND-spec-nexus-compile):
 *   Request body accepts { templateId?, templateVersion?, preferences? }.
 *   templateVersion without templateId is rejected (400).
 *   preferences honored only by default generation.
 *   No raw templates accepted. Fields passed to CompileRequest as-is.
 *
 * P4 audit fixes applied:
 *   T7-F01: compile_started written by OutputCollector — removed from route.
 *   T7-F02: final_response written by compile-return — removed from route.
 *   T7-F03: catch block writes run_closed via closeRunOnCompileError.
 *   T8-F06: compile_mode_selected written by CompileService — removed from route.
 *   T10-F03: duplicate final_response — same as T7-F02 fix.
 */
import type { Express } from 'express';
import type {
  RunLedgerWriter,
  OutputCollector,
  MailboxService,
  CompileService,
  CompileRequest,
  FinalResponseArtifact,
  CompileReturnAck,
  CompilerManifestRecord,
  MailboxManifestRecord,
  CompileReturnEndpointRecord,
  CompilePreferences,
  Uuid,
  NonEmpty,
  IsoTimestamp,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { san } from './shared.js';

// ─── DI Dependencies ───
// socketRegistry and compileReturnDispatcher are bootstrap-owned types.
// Route receives their methods as injected functions — Layer 7 cannot
// import core/externals types directly.

export interface CompileRouteDeps {
  /** RunLedgerWriter for lifecycle events. */
  runLedgerWriter: RunLedgerWriter;
  /** OutputCollector — baked core. Builds output contract from mailbox state. */
  outputCollector: OutputCollector;
  /** MailboxService — baked core. Lists eligible items, marks consumed. */
  mailboxService: MailboxService;
  /** CompileService — baked core. Selects mode, invokes compiler, signs artifact. */
  compileService: CompileService;
  /** Get default enabled compiler from ExternalSocketRegistry. */
  getDefaultCompiler: () => CompilerManifestRecord;
  /** Get primary mailbox from ExternalSocketRegistry. */
  getPrimaryMailbox: () => MailboxManifestRecord;
  /** Resolve compile-return endpoint for a run. From ExternalSocketRegistry. */
  resolveReturnEndpointForRun: (runId: Uuid) => Promise<CompileReturnEndpointRecord>;
  /** Dispatch signed compile-return to workspace endpoint. From CompileReturnDispatcher. */
  dispatchCompileReturn: (input: {
    runId: Uuid;
    endpoint: CompileReturnEndpointRecord;
    artifact: FinalResponseArtifact;
    sentAt: IsoTimestamp;
  }) => Promise<CompileReturnAck>;
}

// ─── T7-F03 Fix: closeRunOnCompileError ───
// Writes run_closed with closeReason: error to Run Ledger on compile failure.
// Best-effort — does not mask the original error if ledger write fails.

async function closeRunOnCompileError(
  runLedgerWriter: RunLedgerWriter,
  runId: Uuid,
  error: unknown
): Promise<void> {
  try {
    await runLedgerWriter.writeEvent({
      runId,
      eventType: 'run_closed',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        closeReason: 'error',
        error: san(error),
      },
    });
  } catch {
    // Best-effort — don't mask the original error
  }
}

// ─── Route Registration ───

export function registerCompileRoutes(app: Express, deps: Partial<CompileRouteDeps>): void {
  app.post('/compile/runs/:runId', async (req, res) => {
    if (
      !deps.runLedgerWriter ||
      !deps.outputCollector ||
      !deps.mailboxService ||
      !deps.compileService ||
      !deps.getDefaultCompiler ||
      !deps.getPrimaryMailbox ||
      !deps.resolveReturnEndpointForRun ||
      !deps.dispatchCompileReturn
    ) {
      res.status(501).json({ ok: false, error: 'Compile not configured' });
      return;
    }

    // Extract runId before try — catch needs it for run_closed (T7-F03)
    const runId = req.params['runId'] as Uuid;

    try {
      // §10: Parse optional template selectors + preferences from request body
      const body = req.body as
        | {
            templateId?: string;
            templateVersion?: string;
            preferences?: CompilePreferences;
          }
        | undefined;

      const templateId =
        typeof body?.templateId === 'string' ? (body.templateId as NonEmpty) : undefined;
      const templateVersion =
        typeof body?.templateVersion === 'string' ? (body.templateVersion as NonEmpty) : undefined;
      const preferences = body?.preferences;

      // §10: templateVersion without templateId is rejected
      if (templateVersion !== undefined && templateId === undefined) {
        res.status(400).json({
          ok: false,
          error: 'templateVersion requires templateId',
        });
        return;
      }

      // §6.8 step 1: build output contract
      // T7-F01: compile_started is written by OutputCollector — not here.
      const outputContract = await deps.outputCollector.buildOutputContract(runId);

      // §6.8 step 2: select enabled compiler from manifest
      const compiler = deps.getDefaultCompiler();
      const mailbox = deps.getPrimaryMailbox();
      const mailboxId = mailbox.mailboxId;

      // §6.8 step 3: list eligible mailbox items
      const items = await deps.mailboxService.listEligibleForCompile(mailboxId, runId);

      // §6.8 step 4: build compile request
      // §10: pass templateId/templateVersion/preferences as-is.
      // exactOptionalPropertyTypes: conditional spread for optional fields.
      const compileRequest: CompileRequest = {
        runId,
        compilerSocketId: compiler.compilerSocketId,
        mailboxId,
        outputContractId: outputContract.outputContractId,
        requestedAt: nowIso(),
        ...(templateId !== undefined ? { templateId } : {}),
        ...(templateVersion !== undefined ? { templateVersion } : {}),
        ...(preferences !== undefined ? { preferences } : {}),
      };

      // §6.8 step 5: invoke compile service
      // T8-F06: compile_mode_selected is written by CompileService — not here.
      const artifact = await deps.compileService.compile(compileRequest, outputContract, items);

      // §6.8 step 6: resolve return endpoint
      const endpoint = await deps.resolveReturnEndpointForRun(runId);

      // §6.8 step 7: dispatch compile-return
      // T7-F02 / T10-F03: final_response is written by compile-return route — not here.
      const sentAt = nowIso();
      const ack = await deps.dispatchCompileReturn({
        runId,
        endpoint,
        artifact,
        sentAt,
      });

      // §6.8 step 8: mark consumed ONLY after successful compile-return acceptance
      if (ack.accepted) {
        const consumedItemIds = items.map(i => i.mailboxItemId);
        await deps.mailboxService.markConsumed(mailboxId, runId, consumedItemIds);
      }

      res.json({
        ok: true,
        data: {
          runId,
          artifactId: artifact.artifactId,
          compileMode: artifact.compileMode,
          returnEndpointId: endpoint.returnEndpointId,
          accepted: ack.accepted,
          acceptedAt: ack.acceptedAt,
        },
      });
    } catch (err) {
      // T7-F03: write run_closed with closeReason: error before returning 500
      await closeRunOnCompileError(deps.runLedgerWriter, runId, err);
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
