/**
 * Reference Deterministic Renderer — AMEND-spec-nexus-compile §9
 *
 * File: packages/core/src/compile/deterministic-renderer.ts
 * Layer 1 — reference compiler implementing Compiler interface.
 *
 * CLEAN BUILD replacing skeleton. Same filename, same export name.
 *
 * Constraints [blueprint §21.4]:
 * - No model call, no action call, no network call except filesystem.
 * - No mutation of source mailbox items.
 * - Deterministic item ordering required for replay.
 * - Actor-registration exempt.
 * - No registry writes (template or otherwise).
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  Compiler,
  CompileRequest,
  OutputContract,
  MailboxItem,
  MailboxService,
  FinalResponseArtifact,
  PayloadResolver,
  RunLedgerWriter,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { sha256Hex } from '../output/output-digest.js';
import { signArtifact } from './final-response-signer.js';
import type { TemplateLoader } from './template-loader.js';
import type { DefaultTemplateGenerator } from './default-template-generator.js';
import type { CompileAssembler } from './compile-assembler.js';

export class DeterministicRenderer implements Compiler {
  readonly compilerSocketId: NonEmpty;
  readonly compilerVersion: NonEmpty;
  private readonly signingKey: string;
  private readonly outputRoot: string;
  private readonly templateLoader: TemplateLoader;
  private readonly defaultTemplateGenerator: DefaultTemplateGenerator;
  private readonly compileAssembler: CompileAssembler;
  private readonly payloadResolvers: PayloadResolver[];
  private readonly runLedgerWriter: RunLedgerWriter;
  /** Optional: when present, the renderer queries listMailboxesForRun
   *  before each compile to produce the (mailboxId → actorId) inverted
   *  provenance map and passes it to the assembler. AMEND-nexus-mailbox-
   *  pit-v0-2-1 §5.2 — provenance recheck defense-in-depth. Older callers
   *  that pre-date Family 4 may omit this dep; the assembler skips the
   *  provenance check when the map is undefined. */
  private readonly mailboxService: MailboxService | null;

  constructor(
    compilerSocketId: NonEmpty,
    signingKey: string,
    outputRoot: string,
    templateLoader: TemplateLoader,
    defaultTemplateGenerator: DefaultTemplateGenerator,
    compileAssembler: CompileAssembler,
    payloadResolvers: PayloadResolver[],
    runLedgerWriter: RunLedgerWriter,
    mailboxService: MailboxService | null = null
  ) {
    this.compilerSocketId = compilerSocketId;
    this.compilerVersion = '1.0.0' as NonEmpty;
    this.signingKey = signingKey;
    this.outputRoot = outputRoot;
    this.templateLoader = templateLoader;
    this.defaultTemplateGenerator = defaultTemplateGenerator;
    this.compileAssembler = compileAssembler;
    this.payloadResolvers = payloadResolvers;
    this.runLedgerWriter = runLedgerWriter;
    this.mailboxService = mailboxService;
  }

  async compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact> {
    // ── Step 0: Pass-through eligibility [Nexus default-secure architecture] ──
    // When no output contract template was selected AND there is exactly one
    // mailbox item, the compiler is a pass-through: write the single agent's
    // mailbox bytes verbatim as the body. No template generation, no slot
    // matching, no slot validation. The single agent's output IS the answer.
    //
    // Multi-agent runs always template (madlib pattern). Single-agent runs
    // WITH an explicit output contract still template (caller wanted a
    // specific shape). Only single-agent + no-contract bypasses.
    //
    // See memory: feedback_nexus_architecture_layers.md
    //   "Pass-through ONLY when: single agent + no output contract attached."
    if (request.templateId === undefined && items.length === 1) {
      return this.compilePassThrough(request, contract, items[0]!);
    }

    // ── Step 1: Template resolution [spec §9.2] ──
    const template =
      request.templateId !== undefined
        ? await this.templateLoader.loadAndVerify(request.templateId, request.templateVersion)
        : this.defaultTemplateGenerator.generate(request.runId, items, request.preferences ?? null);

    // ── Step 2: Emit compile_template_loaded ──
    await this.runLedgerWriter.writeEvent({
      runId: request.runId,
      eventType: 'compile_template_loaded',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        templateDigest: template.templateDigest,
        signatureVerified: true,
        createdBy: template.createdBy,
        systemGenerated: template.createdBy === 'default',
        sectionCount: template.sections.length,
        guardCount: template.guards.length,
      },
    });

    // ── Step 3: Assemble ──
    // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — assembler no longer throws
    // on slot-validation failure or guard halt; per-item failures are
    // collected in result.bypassPartials and event emission happens
    // here from the typed result. The run does NOT die.
    //
    // Build the (mailboxId → actorId) provenance map for the
    // assembler's malformed_output check when MailboxService is wired.
    let mailboxProvenance: ReadonlyMap<NonEmpty, Uuid> | undefined;
    if (this.mailboxService !== null) {
      const actorByMailbox = await this.mailboxService.listMailboxesForRun(request.runId);
      const inverted = new Map<NonEmpty, Uuid>();
      for (const [actorId, mailboxId] of actorByMailbox.entries()) {
        inverted.set(mailboxId, actorId);
      }
      mailboxProvenance = inverted;
    }
    const result = await this.compileAssembler.assemble(
      template,
      items,
      this.payloadResolvers,
      mailboxProvenance ? { mailboxProvenance } : undefined
    );

    if (!result.guardResult.passed && result.guardResult.haltGuard !== null) {
      const halt = result.guardResult.haltGuard;
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_guard_fired',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          guardId: halt.guardId,
          guardName: halt.guardName,
          severity: 'halt',
          conditionLocationPath: halt.condition.locationPath,
          conditionOperator: halt.condition.operator,
          actionEffect: 'halt',
          actionTarget: halt.action.targetLocationPath,
        },
      });
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_guard_halt',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          guardId: halt.guardId,
          guardName: halt.guardName,
        },
      });
    }

    // ── Step 4: Emit per-slot events ──
    for (const [locationId, matchedSlot] of result.matchResult.matched) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_slot_matched',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          locationId,
          expectedSlotId: matchedSlot.location.expectedSlotId,
          matchedItemIds: matchedSlot.items.map(i => i.mailboxItemId),
          itemCount: matchedSlot.items.length,
        },
      });
    }

    for (const u of result.matchResult.unmatched) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_slot_missing',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          locationId: u.location.locationId,
          sectionId: u.sectionId,
          expectedSlotId: u.location.expectedSlotId,
          required: u.required,
          reason: 'no_matching_fill',
        },
      });
    }

    for (const vf of result.validationFailures) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_slot_missing',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          locationId: vf.locationId,
          mailboxItemId: vf.mailboxItemId,
          reason: 'validation_failed',
          validationReason: vf.reason,
        },
      });
    }

    for (const o of result.matchResult.orphaned) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_slot_missing',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          mailboxItemId: o.item.mailboxItemId,
          slotId: o.item.slotId,
          reason: 'no_matching_location',
        },
      });
    }

    // ── Step 5: Emit guard events (non-halt) ──
    for (const fired of result.guardResult.firedGuards) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_guard_fired',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          guardId: fired.guardId,
          guardName: fired.guardName,
          severity: fired.severity,
          conditionLocationPath: fired.condition.locationPath,
          conditionOperator: fired.condition.operator,
          actionEffect: fired.action.effect,
          actionTarget: fired.action.targetLocationPath,
        },
      });
    }

    // ── Step 6: Write body, emit compile_assembly_complete ──
    // bodyRef MUST match the actual on-disk path so the registered
    // file:// payload resolver can read the bytes back. The earlier
    // form had bodyPath = `${outputRoot}/runs/compile/...` while
    // bodyRef dropped the outputRoot prefix, so the two diverged once
    // outputRoot was anything other than '' (in dev it is 'runs', so
    // disk had `runs/runs/compile/...` while the URI pointed at
    // `runs/compile/...`).
    const artifactId = randomUUID() as Uuid;
    const bodyBytes = new TextEncoder().encode(result.body);
    const bodyPath = join(this.outputRoot, 'compile', request.runId, `${artifactId}.txt`);
    await fs.mkdir(dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, bodyBytes);
    const bodyRef = `file://${bodyPath}` as NonEmpty;

    // AMEND-nexus-mailbox-pit-v0-2-1 §3.4.3 / §5.2 — emit one
    // compile_mailbox_item_bypassed ledger event per bypass partial so
    // the audit trail records each item that did not flow into the
    // assembled body.
    for (const bp of result.bypassPartials) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_mailbox_item_bypassed',
        timestamp: nowIso(),
        actorId: bp.sourceActorId,
        detail: {
          mailboxItemId: bp.mailboxItemId,
          sourceMailboxId: bp.sourceMailboxId,
          sourceActorId: bp.sourceActorId,
          bypassReason: bp.bypassReason,
          bypassDisposition: bp.bypassDisposition,
          workspacePartialRef: bp.workspacePartialRef,
        },
      });
    }

    await this.runLedgerWriter.writeEvent({
      runId: request.runId,
      eventType: 'compile_assembly_complete',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        format: result.format,
        itemCount: items.length,
        unmatchedCount: result.matchResult.unmatched.length,
        orphanedCount: result.matchResult.orphaned.length,
        validationFailureCount: result.validationFailures.length,
        bypassPartialCount: result.bypassPartials.length,
        guardsFired: result.guardResult.firedGuards.length,
        warningCount: result.guardResult.warnings.length,
        partial: result.partial,
        bodyDigest: result.bodyDigest,
      },
    });

    // ── Step 7: Build + sign FinalResponseArtifact ──
    const artifactBase: Omit<FinalResponseArtifact, 'signature'> = {
      artifactId,
      runId: request.runId,
      compilerSocketId: this.compilerSocketId,
      compilerActorId: null,
      compileMode: 'deterministic_render',
      bodyRef,
      bodyDigest: result.bodyDigest,
      outputClassifications: contract.inputDataClasses,
      sourceMailboxItems: items.map(i => i.mailboxItemId),
      evidenceRefs: contract.evidenceRefs,
      routingTrailRefs: contract.routingTrailRefs,
      runLedgerRefs: contract.runLedgerRefs,
      createdAt: nowIso(),
      bypassPartials: result.bypassPartials,
    };

    const signature = await signArtifact(artifactBase, this.signingKey);

    return { ...artifactBase, signature };
  }

  /**
   * Pass-through compile: single agent + no output contract.
   * Reads the single mailbox item's bytes via the configured payload
   * resolvers and writes them verbatim as the final artifact body.
   * No template, no slot validation, no JSON.parse — bytes flow through.
   */
  private async compilePassThrough(
    request: CompileRequest,
    contract: OutputContract,
    item: MailboxItem
  ): Promise<FinalResponseArtifact> {
    // Resolve the mailbox item's bytes via the registered resolvers.
    let bodyBytes: Uint8Array | null = null;
    for (const resolver of this.payloadResolvers) {
      if (resolver.canResolve(item.resultRef)) {
        bodyBytes = await resolver.resolveBytes(item.resultRef);
        break;
      }
    }
    if (bodyBytes === null) {
      throw new Error(
        `compile pass-through: no payload resolver accepted resultRef '${item.resultRef}'`
      );
    }

    const artifactId = randomUUID() as Uuid;
    const bodyPath = join(this.outputRoot, 'compile', request.runId, `${artifactId}.txt`);
    await fs.mkdir(dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, bodyBytes);
    const bodyRef = `file://${bodyPath}` as NonEmpty;
    const bodyDigest = sha256Hex(bodyBytes);

    await this.runLedgerWriter.writeEvent({
      runId: request.runId,
      eventType: 'compile_assembly_complete',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        templateId: 'pass_through',
        templateVersion: '0',
        format: 'raw',
        itemCount: 1,
        unmatchedCount: 0,
        orphanedCount: 0,
        validationFailureCount: 0,
        guardsFired: 0,
        warningCount: 0,
        partial: false,
        bodyDigest,
        passThrough: true,
        sourceMailboxItemId: item.mailboxItemId,
        sourceSlotId: item.slotId,
        sourceType: item.sourceType,
      },
    });

    const artifactBase: Omit<FinalResponseArtifact, 'signature'> = {
      artifactId,
      runId: request.runId,
      compilerSocketId: this.compilerSocketId,
      compilerActorId: null,
      compileMode: 'deterministic_render',
      bodyRef,
      bodyDigest,
      outputClassifications: contract.inputDataClasses,
      sourceMailboxItems: [item.mailboxItemId],
      evidenceRefs: contract.evidenceRefs,
      routingTrailRefs: contract.routingTrailRefs,
      runLedgerRefs: contract.runLedgerRefs,
      createdAt: nowIso(),
      // Pass-through has no template + no slot validation, so no
      // bypass partials are possible at this layer.
      bypassPartials: [],
    };

    const signature = await signArtifact(artifactBase, this.signingKey);
    return { ...artifactBase, signature };
  }
}
