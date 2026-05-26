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
import { createHash, randomUUID } from 'node:crypto';
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
import { verifyMailboxItems } from './verify-mailbox-items.js';

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
    // ── Step 0: Pass-through eligibility [Hard Law #11 / F4.12] ──
    // Outline §3 J + §1 HL #11: compile is pass-through when there's
    // nothing to compile. Single-agent + no output contract = forward
    // verbatim; multi-agent without output contract = SAME (bundle).
    // Owner ratification 2026-05-26 closed the §C.3 test-migration
    // blocker that previously kept multi-item routing through the
    // assembler via defaultTemplateGenerator (HL #11 violation).
    //
    // Both pass-through paths call `verifyMailboxItems` first (F4.12
    // §3.1 — single source of truth for digest + provenance check).
    // On verify failure the run does NOT produce a final artifact;
    // both paths emit `compile_quarantined` and throw. No bypass-
    // partial on the pass-through path (bypass-partial remains valid
    // for the templated/assembler path — see compile-assembler-bypass
    // .test.ts).
    if (request.templateId === undefined) {
      if (items.length === 1) {
        return this.compilePassThrough(request, contract, items[0]!);
      }
      return this.compilePassThroughBundle(request, contract, items);
    }

    // ── Step 1: Template resolution [spec §9.2] ──
    // Templated path only — the no-template fallback to
    // defaultTemplateGenerator was retired by F4.12 (HL #11 violation:
    // fabricating a template where the law mandates verbatim pass-
    // through). DefaultTemplateGeneratorImpl is preserved as a class
    // (CMP-09 ci:gate still checks it exists) for any future synthesis-
    // mode plug-in that might want a default template generator.
    const template = await this.templateLoader.loadAndVerify(
      request.templateId,
      request.templateVersion
    );

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
        // Phase 4: explicit `passThrough: false` on the assemble branch so
        // downstream consumers + tests can discriminate
        // template-driven output from Hard Law #11 pass-through (which
        // emits passThrough: true in `compilePassThrough` below).
        passThrough: false,
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
   * Pass-through compile (single-item): one agent + no output contract.
   * F4.12 §3.2 — verify the item via `verifyMailboxItems` first, then
   * write the resolved bytes verbatim as the final artifact body. No
   * template, no slot validation, no JSON.parse, no bypass partial.
   *
   * On any verify failure: emit `compile_quarantined` ledger event with
   * `{reason, mailboxItemId, sourceMailboxId, passThrough: 'single'}`
   * detail, then throw. The run does NOT produce a final artifact
   * (HL #11 fail-closed; workspace receives the throw and closes the
   * run with the appropriate closeReason).
   */
  private async compilePassThrough(
    request: CompileRequest,
    contract: OutputContract,
    item: MailboxItem
  ): Promise<FinalResponseArtifact> {
    // F4.12 §3.1 — verify FIRST, before any artifact construction.
    const verifyResult = await verifyMailboxItems([item], this.payloadResolvers);
    if (!verifyResult.ok) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_quarantined',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          reason: verifyResult.reason,
          mailboxItemId: verifyResult.mailboxItemId,
          sourceMailboxId: verifyResult.sourceMailboxId,
          itemCount: 1,
          passThrough: 'single',
          detail: verifyResult.detail,
        },
      });
      throw new Error(
        `compile pass-through (single): quarantine — ${verifyResult.reason}: ${verifyResult.detail}`
      );
    }
    const bodyBytes = verifyResult.resolvedItems[0]!.bytes;

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

  /**
   * Pass-through bundle compile (multi-item + no output contract).
   * F4.12 §3.3 — verify all items via `verifyMailboxItems` first; on
   * success deterministically concat their bytes (sorted by
   * `mailboxItemId` so replay is byte-identical) and write the
   * concatenation as the artifact body.
   *
   * `aggregateDigest` (the Merkle-style sha256 of the canonical concat
   * of per-item resultDigests, per F4.12 §3.3 step 2) is emitted in the
   * `compile_assembly_complete` ledger event detail for audit. The
   * flat artifact's `bodyDigest` is sha256 of the concatenated body
   * bytes — the natural digest of what's on disk and what consumers
   * read back. The two digests serve different purposes: bodyDigest =
   * "did the file change?"; aggregateDigest = "did the set of inputs
   * change?".
   *
   * On any verify failure: emit `compile_quarantined` + throw (same
   * shape as single-item path). The pass-through bundle path does NOT
   * support bypass-partial — per F4.12 §1 scope, partial-quarantine is
   * not permitted; any item failure quarantines the whole bundle.
   */
  private async compilePassThroughBundle(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact> {
    // F4.12 §3.1 — verify FIRST, before any artifact construction.
    const verifyResult = await verifyMailboxItems(items, this.payloadResolvers);
    if (!verifyResult.ok) {
      await this.runLedgerWriter.writeEvent({
        runId: request.runId,
        eventType: 'compile_quarantined',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          reason: verifyResult.reason,
          mailboxItemId: verifyResult.mailboxItemId,
          sourceMailboxId: verifyResult.sourceMailboxId,
          itemCount: items.length,
          passThrough: 'bundle',
          detail: verifyResult.detail,
        },
      });
      throw new Error(
        `compile pass-through (bundle): quarantine — ${verifyResult.reason}: ${verifyResult.detail}`
      );
    }

    // Deterministic order: sort by mailboxItemId so replay is byte-
    // identical regardless of mailbox-listing order (allocations may
    // come back in any order from listMailboxesForRun).
    const ordered = [...verifyResult.resolvedItems].sort((a, b) =>
      a.item.mailboxItemId < b.item.mailboxItemId
        ? -1
        : a.item.mailboxItemId > b.item.mailboxItemId
          ? 1
          : 0
    );

    // Canonical concat of per-item bytes (deterministic order).
    const totalLength = ordered.reduce((sum, r) => sum + r.bytes.length, 0);
    const bodyBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const { bytes } of ordered) {
      bodyBytes.set(bytes, offset);
      offset += bytes.length;
    }
    const bodyDigest = sha256Hex(bodyBytes);

    // F4.12 §3.3 step 2 — aggregateDigest = sha256(canonical concat of
    // per-item resultDigests, in the same deterministic order).
    const aggregateDigest = createHash('sha256')
      .update(ordered.map(r => r.item.resultDigest).join(''))
      .digest('hex');

    const artifactId = randomUUID() as Uuid;
    const bodyPath = join(this.outputRoot, 'compile', request.runId, `${artifactId}.txt`);
    await fs.mkdir(dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, bodyBytes);
    const bodyRef = `file://${bodyPath}` as NonEmpty;

    await this.runLedgerWriter.writeEvent({
      runId: request.runId,
      eventType: 'compile_assembly_complete',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        templateId: 'pass_through_bundle',
        templateVersion: '0',
        format: 'raw',
        itemCount: ordered.length,
        unmatchedCount: 0,
        orphanedCount: 0,
        validationFailureCount: 0,
        guardsFired: 0,
        warningCount: 0,
        partial: false,
        bodyDigest,
        passThrough: true,
        bundle: true,
        aggregateDigest,
        sourceMailboxItemIds: ordered.map(r => r.item.mailboxItemId),
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
      sourceMailboxItems: ordered.map(r => r.item.mailboxItemId),
      evidenceRefs: contract.evidenceRefs,
      routingTrailRefs: contract.routingTrailRefs,
      runLedgerRefs: contract.runLedgerRefs,
      createdAt: nowIso(),
      // Pass-through bundle: per F4.12 §1 scope, no partial-quarantine
      // — any verify failure aborts the whole bundle (see early-return
      // above). So bypassPartials is always empty here.
      bypassPartials: [],
    };

    const signature = await signArtifact(artifactBase, this.signingKey);
    return { ...artifactBase, signature };
  }
}
