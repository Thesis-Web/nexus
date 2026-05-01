/**
 * Baked Compile Service — AMEND-spec §3.9, §8.2
 *
 * File: packages/core/src/compile/compile-service.ts
 * Layer 1 — baked core infrastructure. NOT a replaceable plugin.
 *
 * Selects the configured compiler from CompilerManifestRecord, enforces
 * OCT-COMPILE inheritance, invokes the compiler, and returns the artifact.
 *
 * selectCompileMode uses the manifest record and compile config, not the
 * Compiler implementation object. The compiler does not self-authorize.
 */
import type {
  CompileService as ICompileService,
  CompileRequest,
  OutputContract,
  MailboxItem,
  FinalResponseArtifact,
  CompileMode,
  CompilerManifestRecord,
  CompileConfig,
  Compiler,
  RunLedgerWriter,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';

export class CompileServiceImpl implements ICompileService {
  private readonly compiler: Compiler;
  private readonly compilerRecord: CompilerManifestRecord;
  private readonly config: CompileConfig;
  private readonly ledgerWriter: RunLedgerWriter;

  constructor(
    compiler: Compiler,
    compilerRecord: CompilerManifestRecord,
    config: CompileConfig,
    ledgerWriter: RunLedgerWriter
  ) {
    this.compiler = compiler;
    this.compilerRecord = compilerRecord;
    this.config = config;
    this.ledgerWriter = ledgerWriter;
  }

  selectCompileMode(
    contract: OutputContract,
    compilerRecord: CompilerManifestRecord,
    config: CompileConfig
  ): CompileMode {
    // If only deterministic_render is allowed, return it
    if (
      compilerRecord.allowedModes.length === 1 &&
      compilerRecord.allowedModes[0] === 'deterministic_render'
    ) {
      return 'deterministic_render';
    }

    // Frontier synthesis path
    if (
      contract.compileEligibility.frontierSynthesis &&
      config.preferFrontierSynthesis &&
      compilerRecord.allowedModes.includes('frontier_synthesis')
    ) {
      return 'frontier_synthesis';
    }

    // On-prem synthesis path
    if (
      contract.compileEligibility.onPremSynthesis &&
      compilerRecord.allowedModes.includes('on_prem_synthesis')
    ) {
      return 'on_prem_synthesis';
    }

    // Default fallback
    return 'deterministic_render';
  }

  async compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact> {
    const mode = this.selectCompileMode(contract, this.compilerRecord, this.config);

    // Write compile_mode_selected ledger event
    await this.ledgerWriter.writeEvent({
      runId: request.runId,
      eventType: 'compile_mode_selected',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        compilerSocketId: this.compilerRecord.compilerSocketId,
        compileMode: mode,
        actorRegistration: this.compilerRecord.actorRegistration,
        compilerActorId: this.compilerRecord.compilerActorId,
        outputContractId: contract.outputContractId,
        itemCount: items.length,
        inheritedCompileDataClass: contract.inheritedCompileDataClass,
        frontierEligible: contract.compileEligibility.frontierSynthesis,
        preferFrontierSynthesis: this.config.preferFrontierSynthesis,
      },
    });

    // Invoke the selected compiler
    const artifact = await this.compiler.compile(request, contract, items);

    // ── T7-F05: Verify artifact integrity after compiler returns ──────────
    // Non-reference compilers could return mismatched fields.
    if (artifact.runId !== request.runId) {
      throw new Error(
        `Compile artifact integrity: runId mismatch (expected '${request.runId}', got '${artifact.runId}')`
      );
    }
    if (artifact.compilerSocketId !== request.compilerSocketId) {
      throw new Error(
        `Compile artifact integrity: compilerSocketId mismatch (expected '${request.compilerSocketId}', got '${artifact.compilerSocketId}')`
      );
    }
    if (artifact.compileMode !== mode) {
      throw new Error(
        `Compile artifact integrity: compileMode mismatch (selected '${mode}', artifact reports '${artifact.compileMode}')`
      );
    }
    // Verify source item set matches input
    const inputIds = new Set(items.map(i => i.mailboxItemId));
    const artifactIds = new Set(artifact.sourceMailboxItems);
    if (inputIds.size !== artifactIds.size || [...inputIds].some(id => !artifactIds.has(id))) {
      throw new Error(
        `Compile artifact integrity: sourceMailboxItems mismatch (expected ${inputIds.size} items, got ${artifactIds.size})`
      );
    }
    // Verify classifications do not understate input
    const inputClasses = new Set(contract.inputDataClasses);
    for (const cls of inputClasses) {
      if (!artifact.outputClassifications.includes(cls)) {
        throw new Error(
          `Compile artifact integrity: outputClassifications understate input (missing '${cls}')`
        );
      }
    }

    return artifact;
  }
}
