/**
 * Compile Reference Harness Route — AMEND-spec §6.8, §11.2
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
 * Run Ledger events (§6.8):
 *   - compile_started when output contract is created
 *   - compile_mode_selected after compile mode is selected
 *   - final_response after artifact created and compile-return handoff accepted
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

    try {
      const runId = req.params['runId'] as Uuid;

      // §6.8 step 1: build output contract
      const outputContract = await deps.outputCollector.buildOutputContract(runId);

      // Write Run Ledger compile_started
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'compile_started',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          outputContractId: outputContract.outputContractId,
          mailboxId: outputContract.mailboxId,
          mailboxItemCount: outputContract.mailboxItems.length,
          inputDataClasses: outputContract.inputDataClasses,
          inheritedCompileDataClass: outputContract.inheritedCompileDataClass,
          contractDigest: outputContract.contractDigest,
        },
      });

      // §6.8 step 2: select enabled compiler from manifest
      const compiler = deps.getDefaultCompiler();
      const mailbox = deps.getPrimaryMailbox();
      const mailboxId = mailbox.mailboxId;

      // §6.8 step 3: list eligible mailbox items
      const items = await deps.mailboxService.listEligibleForCompile(mailboxId, runId);

      // §6.8 step 4: build compile request
      const compileRequest: CompileRequest = {
        runId,
        compilerSocketId: compiler.compilerSocketId,
        mailboxId,
        outputContractId: outputContract.outputContractId,
        requestedAt: nowIso(),
      };

      // §6.8 step 5: invoke compile service
      const artifact = await deps.compileService.compile(compileRequest, outputContract, items);

      // Write Run Ledger compile_mode_selected
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'compile_mode_selected',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          compilerSocketId: compiler.compilerSocketId,
          compileMode: artifact.compileMode,
          outputContractId: outputContract.outputContractId,
          artifactId: artifact.artifactId,
        },
      });

      // §6.8 step 6: resolve return endpoint
      const endpoint = await deps.resolveReturnEndpointForRun(runId);

      // §6.8 step 7: dispatch compile-return
      const sentAt = nowIso();
      const ack = await deps.dispatchCompileReturn({
        runId,
        endpoint,
        artifact,
        sentAt,
      });

      // Write Run Ledger final_response after successful handoff
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'final_response',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          artifactId: artifact.artifactId,
          compilerSocketId: artifact.compilerSocketId,
          compileMode: artifact.compileMode,
          bodyRef: artifact.bodyRef,
          bodyDigest: artifact.bodyDigest,
          returnEndpointId: endpoint.returnEndpointId,
          sourceMailboxItemCount: artifact.sourceMailboxItems.length,
          accepted: ack.accepted,
          acceptedAt: ack.acceptedAt,
        },
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
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
