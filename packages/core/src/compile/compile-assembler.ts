/**
 * Compile Assembler — AMEND-spec-nexus-compile §8.7
 *
 * File: packages/core/src/compile/compile-assembler.ts
 * Layer 1 — full assembly pipeline wiring all compile-ref components.
 *
 * Pipeline:
 *   Phase 1: matchResult = slotMatcher.match(template, items)
 *   Phase 2: resolve fills via PayloadResolver, validate via slotValidator
 *   Phase 3: guardResult = guardEvaluator.evaluate(template, matchResult, items)
 *   Phase 4: denialOutput = denialMarkerInserter.insert(template, unmatched, denialHandling)
 *   Phase 5: body = formatRenderers.get(format).render(...)
 *
 * Deterministic ordering guaranteed by all sub-components.
 */
import type {
  BypassPartial,
  CompileTemplate,
  CompileFormat,
  MailboxItem,
  PayloadResolver,
  NonEmpty,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import { sha256Hex } from '../output/output-digest.js';
import type { SlotMatcher, SlotMatchResult } from './slot-matcher.js';
import type { SlotValidator } from './slot-validator.js';
import type { GuardEvaluator, GuardEvaluationResult } from './guard-evaluator.js';
import type { DenialMarkerInserter } from './denial-marker-inserter.js';
import type { FormatRenderer } from './format-renderer.js';
import { assertNotFileBundleFormat } from './format-renderer.js';
import { CompileAssemblyError } from './compile-errors.js';

// ─── Result Types [spec §8.7] ───

export interface ValidationFailure {
  locationId: NonEmpty;
  mailboxItemId: NonEmpty;
  reason: NonEmpty;
}

export interface AssemblyResult {
  body: string;
  bodyDigest: Sha256Hex;
  matchResult: SlotMatchResult;
  guardResult: GuardEvaluationResult;
  validationFailures: ValidationFailure[];
  format: CompileFormat;
  partial: boolean;
  /** AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — per-item bypass partials
   *  collected during assembly (slot validation failures, guard halts,
   *  etc.). Empty when assembly was clean. The assembler returns these
   *  for the renderer to emit ledger events and include on the
   *  FinalResponseArtifact. */
  bypassPartials: readonly BypassPartial[];
}

// ─── Interface ───

/**
 * Optional per-call assembly inputs introduced by the mailbox-pit V1
 * compile bypass surface (AMEND-nexus-mailbox-pit-v0-2-1 §5.2 disposition
 * rows for malformed_output + digest_mismatch). Both checks are
 * defense-in-depth on top of Family 4's write-time MailboxService
 * assertion; the compile path adds a second pair of eyes against
 * tampered storage or non-Nexus writes.
 *
 *   mailboxProvenance: invert of MailboxService.listMailboxesForRun
 *     (mailboxId → actorId). When provided, the assembler verifies each
 *     item's `agentId` matches the mailbox-derived actorId; mismatch
 *     produces a malformed_output / withhold_quarantine bypass.
 *
 *   When mailboxProvenance is undefined the provenance check is skipped
 *   (back-compat for older callers and unit tests that don't supply a
 *   live MailboxService). The renderer in the composition root always
 *   passes a real map.
 */
export interface AssemblyOptions {
  readonly mailboxProvenance?: ReadonlyMap<NonEmpty, Uuid>;
}

export interface CompileAssembler {
  assemble(
    template: CompileTemplate,
    items: MailboxItem[],
    payloadResolvers: PayloadResolver[],
    options?: AssemblyOptions
  ): Promise<AssemblyResult>;
}

// ─── Implementation ───

export class CompileAssemblerImpl implements CompileAssembler {
  private readonly slotMatcher: SlotMatcher;
  private readonly slotValidator: SlotValidator;
  private readonly guardEvaluator: GuardEvaluator;
  private readonly formatRenderers: Map<CompileFormat, FormatRenderer>;
  private readonly denialMarkerInserter: DenialMarkerInserter;

  constructor(
    slotMatcher: SlotMatcher,
    slotValidator: SlotValidator,
    guardEvaluator: GuardEvaluator,
    formatRenderers: Map<CompileFormat, FormatRenderer>,
    denialMarkerInserter: DenialMarkerInserter
  ) {
    this.slotMatcher = slotMatcher;
    this.slotValidator = slotValidator;
    this.guardEvaluator = guardEvaluator;
    this.formatRenderers = formatRenderers;
    this.denialMarkerInserter = denialMarkerInserter;
  }

  async assemble(
    template: CompileTemplate,
    items: MailboxItem[],
    payloadResolvers: PayloadResolver[],
    options?: AssemblyOptions
  ): Promise<AssemblyResult> {
    // file_bundle fail-closed [DIFF-S23-001]
    assertNotFileBundleFormat(template.format);

    // ── Phase 1: Match slots ──
    const matchResult = this.slotMatcher.match(template, items);

    // ── Phase 2: Resolve fills + validate ──
    const validatedFills = new Map<string, unknown>();
    const validationFailures: ValidationFailure[] = [];
    // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — bypass partials accumulated
    // during assembly. Validation failures (required + optional) become
    // render_partial bypasses; guard halts become withhold_quarantine.
    const bypassPartials: BypassPartial[] = [];
    // Track which items have been bypassed in this assembly so guard-halt
    // bypass collection in phase 3 doesn't double-record items that
    // already failed provenance / digest / validation.
    const bypassedItemIds = new Set<Uuid>();

    for (const [locationId, matchedSlot] of matchResult.matched) {
      for (const item of matchedSlot.items) {
        // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — provenance recheck
        // (defense-in-depth on Family 4's write-time assertion). When
        // the renderer supplies a mailboxProvenance map, the item's
        // claimed agentId MUST match the actorId the mailbox was
        // allocated to. Mismatch ⇒ malformed_output / withhold_quarantine.
        const provenance = options?.mailboxProvenance;
        if (provenance) {
          const derivedActorId = provenance.get(item.mailboxId);
          if (derivedActorId !== undefined && derivedActorId !== item.agentId) {
            bypassPartials.push({
              mailboxItemId: item.mailboxItemId,
              sourceMailboxId: item.mailboxId,
              sourceActorId: derivedActorId,
              bypassReason: 'malformed_output',
              bypassDisposition: 'withhold_quarantine',
              workspacePartialRef: null,
            });
            bypassedItemIds.add(item.mailboxItemId);
            continue;
          }
        }

        // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — digest re-verification
        // (defense-in-depth on Family 4's write-time digest verify). If
        // the bytes on disk hash to something other than item.resultDigest,
        // the storage has been tampered with or corrupted between write
        // and compile. Quarantine the item, never render its raw bytes.
        const digestOk = await this.verifyDigestForItem(item, payloadResolvers);
        if (!digestOk) {
          bypassPartials.push({
            mailboxItemId: item.mailboxItemId,
            sourceMailboxId: item.mailboxId,
            sourceActorId: item.agentId as Uuid,
            bypassReason: 'digest_mismatch',
            bypassDisposition: 'withhold_quarantine',
            workspacePartialRef: null,
          });
          bypassedItemIds.add(item.mailboxItemId);
          continue;
        }

        // Resolve payload bytes (decoded fill value)
        const fillValue = await this.resolvePayload(item.resultRef, payloadResolvers);

        // Validate against slot type
        const validationResult = await this.slotValidator.validate(matchedSlot.location, fillValue);

        if (!validationResult.valid) {
          // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 disposition table:
          //   "Slot type validator rejects → slot_type_mismatch / render_partial"
          // Required + optional both become bypass partials. Required
          // slots ALSO leave the slot unfilled (denial marker emitted by
          // phase 4). Optional slots are skipped. The run does NOT die
          // (no throw) — the bypass surfaces to the workspace.
          for (const err of validationResult.errors) {
            validationFailures.push({
              locationId: err.locationId,
              mailboxItemId: item.mailboxItemId as NonEmpty,
              reason: err.reason as NonEmpty,
            });
          }
          bypassPartials.push({
            mailboxItemId: item.mailboxItemId,
            sourceMailboxId: item.mailboxId,
            sourceActorId: item.agentId as Uuid,
            bypassReason: 'slot_type_mismatch',
            bypassDisposition: 'render_partial',
            workspacePartialRef: item.resultRef,
          });
          bypassedItemIds.add(item.mailboxItemId);
          continue;
        }

        // Store validated fill (last item wins for non-repeating)
        validatedFills.set(locationId, fillValue);
      }
    }

    // ── Phase 3: Evaluate guards ──
    const guardResult = this.guardEvaluator.evaluate(template, matchResult, items);

    if (!guardResult.passed && guardResult.haltGuard !== null) {
      // AMEND-nexus-mailbox-pit-v0-2-1 §5.2 disposition table:
      //   "guard.halt fired on the item's OCT class → guard_halt /
      //    withhold_quarantine"
      // V1 behavior: every item in the matched slots that the halt
      // condition touches is bypass-quarantined; the slots stay
      // unfilled (denial markers in phase 4); the run does NOT die.
      // Per-item granularity beyond "all items touched by the halt"
      // requires a guard-evaluator enrichment — captured as future
      // work; today we conservatively quarantine the set of items the
      // halt guard would have killed the run for.
      const halt = guardResult.haltGuard;
      const haltedLocPath = halt.condition.locationPath;
      // Find items that landed in slot(s) the halt condition references.
      // For V1, conservatively bypass every item in every matched slot
      // — guard halts already indicate an artifact-level rejection.
      void haltedLocPath;
      for (const [, matched] of matchResult.matched) {
        for (const item of matched.items) {
          // Don't double-bypass items already recorded earlier in the
          // pipeline (provenance / digest / validation failures).
          if (bypassedItemIds.has(item.mailboxItemId)) continue;
          bypassPartials.push({
            mailboxItemId: item.mailboxItemId,
            sourceMailboxId: item.mailboxId,
            sourceActorId: item.agentId as Uuid,
            bypassReason: 'guard_halt',
            bypassDisposition: 'withhold_quarantine',
            workspacePartialRef: null,
          });
          bypassedItemIds.add(item.mailboxItemId);
        }
      }
      // Clear validatedFills so the renderer produces denial markers
      // for the affected slots rather than substituting unsafe content.
      validatedFills.clear();
    }

    // Apply auto_fix modifications
    for (const mod of guardResult.modifications) {
      if (mod.effect === 'set_value' && mod.value !== undefined) {
        // Static set_value in V1 — apply to target location
        // Target is a path: sectionId.locationId — extract locationId
        const segments = mod.targetLocationPath.split('.');
        const targetLocationId = segments[segments.length - 1]!;
        validatedFills.set(targetLocationId, mod.value);
      }
      if (mod.effect === 'set_required') {
        // set_required doesn't change fill values — it changes template constraint
        // This is enforced during denial marking (required slots produce markers)
      }
    }

    // ── Phase 4: Insert denial markers ──
    const denialOutput = this.denialMarkerInserter.insert(
      template,
      matchResult.unmatched,
      template.denialHandling
    );

    // ── Phase 5: Render ──
    const renderer = this.formatRenderers.get(template.format);
    if (renderer === undefined) {
      throw new CompileAssemblyError(
        DENIAL_CODE.FILE_BUNDLE_DENIED,
        `No renderer registered for format '${template.format}'`
      );
    }

    const body = renderer.render(
      template,
      matchResult,
      validatedFills,
      denialOutput,
      guardResult.warnings
    );

    const bodyDigest = sha256Hex(body) as Sha256Hex;

    const partial = matchResult.unmatched.some(u => u.required) || validationFailures.length > 0;

    return {
      body,
      bodyDigest,
      matchResult,
      guardResult,
      validationFailures,
      format: template.format,
      partial: partial || bypassPartials.length > 0,
      bypassPartials,
    };
  }

  // ─── Private ───

  /**
   * AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — compile-time digest re-verify.
   * Re-resolves the raw bytes and compares sha256 against the mailbox
   * item's stored resultDigest. Returns true when they match, false
   * when they don't (tampering / corruption between write and compile)
   * OR when no resolver accepts the resultRef (the assembler's existing
   * happy path returns a placeholder string — we treat that as bypass).
   */
  private async verifyDigestForItem(
    item: MailboxItem,
    resolvers: PayloadResolver[]
  ): Promise<boolean> {
    for (const resolver of resolvers) {
      if (resolver.canResolve(item.resultRef)) {
        try {
          const bytes = await resolver.resolveBytes(item.resultRef);
          const actual = sha256Hex(bytes);
          return actual === item.resultDigest;
        } catch {
          return false;
        }
      }
    }
    // No resolver accepted the ref → cannot verify → fail closed.
    return false;
  }

  /**
   * Resolve a resultRef to a decoded fill value via PayloadResolvers.
   * Tries each resolver; first that canResolve wins.
   * Decodes bytes: try JSON.parse first, fall back to UTF-8 string.
   */
  private async resolvePayload(
    resultRef: NonEmpty,
    resolvers: PayloadResolver[]
  ): Promise<unknown> {
    for (const resolver of resolvers) {
      if (resolver.canResolve(resultRef)) {
        const bytes = await resolver.resolveBytes(resultRef);
        const text = new TextDecoder().decode(bytes);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }
    }
    // No resolver found — return the resultRef as a string placeholder
    return `[unresolvable: ${resultRef}]`;
  }
}
