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
import { CompileGuardHaltError } from './compile-errors.js';

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

  constructor(
    compilerSocketId: NonEmpty,
    signingKey: string,
    outputRoot: string,
    templateLoader: TemplateLoader,
    defaultTemplateGenerator: DefaultTemplateGenerator,
    compileAssembler: CompileAssembler,
    payloadResolvers: PayloadResolver[],
    runLedgerWriter: RunLedgerWriter
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
  }

  async compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact> {
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
    let result;
    try {
      result = await this.compileAssembler.assemble(template, items, this.payloadResolvers);
    } catch (error) {
      if (error instanceof CompileGuardHaltError) {
        // Emit guard events before re-throwing
        await this.runLedgerWriter.writeEvent({
          runId: request.runId,
          eventType: 'compile_guard_fired',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            guardId: error.guardId,
            guardName: error.guardName,
            severity: 'halt',
            conditionLocationPath: error.conditionLocationPath,
            conditionOperator: error.conditionOperator,
            actionEffect: 'halt',
            actionTarget: error.actionTarget,
          },
        });
        await this.runLedgerWriter.writeEvent({
          runId: request.runId,
          eventType: 'compile_guard_halt',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            guardId: error.guardId,
            guardName: error.guardName,
          },
        });
      }
      throw error;
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
    const artifactId = randomUUID() as Uuid;
    const bodyBytes = new TextEncoder().encode(result.body);
    const bodyPath = join(this.outputRoot, 'runs', 'compile', request.runId, `${artifactId}.txt`);
    await fs.mkdir(dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, bodyBytes);
    const bodyRef = `file://runs/compile/${request.runId}/${artifactId}.txt` as NonEmpty;

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
    };

    const signature = await signArtifact(artifactBase, this.signingKey);

    return { ...artifactBase, signature };
  }
}
