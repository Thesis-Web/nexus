/**
 * NXS Result → Mailbox bridge.
 *
 * After NXS dispatches a tool-call action through the gate pipeline and a
 * connector returns its ExecutionResult, the orchestrator needs the result
 * to land in the run's mailbox so that:
 *
 *   - downstream plan nodes can read it via slot lookup,
 *   - the same agent on its next turn can pick it up as an inbox message,
 *   - compile can include it in the final artifact when sectioned-template
 *     contracts are in play,
 *   - audit links the EvidenceRecord to the mailbox entry.
 *
 * Gate 06's contract is fixed (it only knows about the connector + grant
 * vault), so this bridging cannot live inside it. Composition root owns it.
 *
 * The connector itself wrote the actual data to runs/payloads/<runId>/
 * <actionId>.json (see PostgresConnector). This helper:
 *   1. Derives the payload file path from runId + actionId.
 *   2. Reads the file bytes once to compute the SHA-256 digest the
 *      mailbox item carries.
 *   3. Builds an NxsOutputReference (already in @nexus/contracts).
 *   4. Calls outputCollector.writeMailboxItemFromNxsResult — same path
 *      NVG model results already use, no new mailbox machinery.
 *
 * Receipt branch (write-only / failure outcomes):
 *   When executionResult exists but the connector did NOT produce a payload
 *   file — either the action failed, or the action succeeded with no body
 *   (e.g. INSERT / UPDATE / DELETE that returned no rows) — the bridge
 *   synthesizes a small receipt JSON from the EvidenceRecord and writes it
 *   to runs/payloads/<runId>/<actionId>.receipt.json. The mailbox item is
 *   built the same way (sourceType: 'nxs_execution_result', same default
 *   slot) so the orchestrator's round-trip loop can feed every tool call
 *   back to the LLM uniformly: tool_result content is always the file bytes.
 *
 * Denial-receipt branch (Gate 06 never ran):
 *   When executionResult IS null on the evidence — Gate 06 was skipped
 *   because the pipeline denied at Gates 01–05 (auth / RBAC / classification
 *   / delegation / policy / approval) or ran in observe/advisory mode —
 *   the bridge synthesizes a denial receipt from the evidence's
 *   `gateDecisions[]` + `finalOutcome` and writes
 *   runs/payloads/<runId>/<actionId>.denial-receipt.json. NXS's decision
 *   still lands in the per-actor mailbox so compile can include the denial
 *   reason in the run's final response.
 *
 *   Hard Law #4 (orch never kills) + #8 (mailbox is the only seam) require
 *   this: when NXS denies, the decision is governance output, not silent
 *   loss. Returning null here would force the orchestrator to fail-close
 *   the node with no surface, which is what
 *   `NXS-DISPATCH-BRIDGE-RETURNS-NULL` actually was — the bridge swallowing
 *   the denial.
 *
 * Never returns null. Every legitimate evidence record produces a
 * BridgeResult; unexpected I/O errors propagate as exceptions.
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
  DataClass,
  EvidenceRecord,
  IsoTimestamp,
  MailboxItem,
  NxsOutputReference,
  NonEmpty,
  OctLevel,
  OutputCollector,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { newUuid } from '@nexus/contracts';

export interface BridgeDeps {
  /** Composition-root OutputCollector — same instance NVG results use. */
  readonly outputCollector: OutputCollector;
  /** Absolute path to runs/payloads (where postgres-shaped connectors land their JSON). */
  readonly payloadsRoot: string;
  /** OCT level of the dispatching agent — required on the mailbox item. */
  readonly agentOctLevel: OctLevel;
  /**
   * Slot identifier the produced mailbox item belongs to. Compile + downstream
   * node lookups key off this. Defaults to 'nxs_result' if the caller has no
   * better information; orchestrator-issued tool calls may pass the originating
   * node's expectedOutputSlots[0] for cleaner DAG slot routing. Receipts share
   * the same slot so the orchestrator round-trip can read tool results
   * uniformly regardless of whether the connector returned data or a receipt.
   */
  readonly slotId?: NonEmpty;
  /**
   * Override the mailbox item's `taskId`. By default the bridge uses
   * `evidence.actionId` so each tool-call sub-action maps 1:1 to a
   * mailbox item — correct behavior for nvg_dispatch round-trip
   * intermediates. For nxs_dispatch nodes (multi-node planner) we want
   * the item to be addressable by the planner's `nodeId` so downstream
   * nodes can look it up via inputSlotReads → MailboxService.findBySlot.
   * Passing the node's `nodeId` here makes the produced item discoverable
   * at slot-read time.
   */
  readonly taskIdOverride?: Uuid;
  /**
   * AMEND-nexus-mailbox-pit-v0-2-1 §3.6 — the per-actor mailboxId
   * allocated to the dispatching agent for this run. The caller looks
   * it up via mailboxService.getMailboxForActor(runId, agentId) before
   * invoking the bridge. The bridge passes it through to the
   * OutputCollector's MailboxWriteContext.
   */
  readonly mailboxId: NonEmpty;
  /**
   * Spec §7.3 — the dataClass declared by the connector manifest for
   * the target system this action ran against (e.g. postgres-warehouse
   * declares `dataClass: internal`). The bridge writes it into the
   * mailbox item's `resultClassifications` so the mailbox eligibility
   * check (which gates `classificationRequired: true` mailboxes) passes
   * and compile can read the item. Without this, the item lands with
   * `resultClassifications: []` and is correctly fail-closed-blocked at
   * MailboxService.write, leaving compile with no eligible input —
   * surfacing as `output_contract_empty` and `closeReason: error` after
   * a fully-successful NXS dispatch. The classification is taken from
   * the same connector record the orchestrator already binds against
   * (see `connectorLookup` in nexus-main.ts), so this is the single
   * authoritative source — not invented, not widened.
   */
  readonly targetDataClass: DataClass;
}

export interface BridgeResult {
  readonly mailboxItem: MailboxItem;
  /** Absolute path to the file the mailbox item references — either the
   * connector-emitted payload, a synthesized receipt JSON, or a synthesized
   * denial receipt JSON. Round-trip callers read this to build the next
   * NVG turn's tool_result message (when applicable) and compile reads
   * the same file for assembly. */
  readonly payloadPath: string;
  readonly resultDigest: Sha256Hex;
  /**
   * Discriminates the three branches so callers can log + classify
   * accordingly. All three flow through the same OutputCollector entry
   * point.
   *
   *   'data'            connector wrote a payload file; we hashed it.
   *   'receipt'         connector executed (success or failure) but no
   *                     payload file — receipt synthesized from
   *                     `executionResult`.
   *   'denial_receipt'  Gate 06 never ran (pre-execution denial or
   *                     non-enforcing mode); receipt synthesized from
   *                     `gateDecisions[]` + `finalOutcome` so the
   *                     denial still lands in the mailbox.
   */
  readonly kind: 'data' | 'receipt' | 'denial_receipt';
}

/**
 * Build an NxsOutputReference from an EvidenceRecord + the on-disk payload
 * file the connector wrote (or a synthesized receipt when no payload exists,
 * or a synthesized denial receipt when Gate 06 never ran), then write a
 * mailbox item via the composition-root OutputCollector.
 *
 * Never returns null. NXS's decision — execute, error, deny — always lands
 * in the mailbox so HL#4 (orch never kills) + HL#8 (mailbox is the only
 * seam) hold. Unexpected I/O errors propagate as exceptions; the caller's
 * try/catch surfaces them to the express error handler.
 */
export async function bridgeNxsResultToMailbox(
  evidence: EvidenceRecord,
  deps: BridgeDeps
): Promise<BridgeResult> {
  const exec = evidence.executionResult;

  let resultPath: string;
  let resultDigest: Sha256Hex;
  let kind: 'data' | 'receipt' | 'denial_receipt';

  if (exec === null) {
    // Gate 06 never ran. NXS still has a decision (in gateDecisions[]
    // + finalOutcome) — synthesize a denial receipt so the mailbox
    // carries it. This is what fixes NXS-DISPATCH-BRIDGE-RETURNS-NULL:
    // the bridge no longer silently drops a governance denial.
    const denial = await synthesizeDenialReceipt(evidence, deps.payloadsRoot);
    resultPath = denial.receiptPath;
    resultDigest = denial.digest;
    kind = 'denial_receipt';
  } else {
    const payloadPath = path.join(deps.payloadsRoot, evidence.runId, `${evidence.actionId}.json`);

    let bytes: Buffer | null = null;
    if (exec.status === 'success') {
      try {
        bytes = await fs.readFile(payloadPath);
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code;
        // ENOENT is the expected miss for write-only successes — fall
        // through to receipt synthesis. Any other error is a real I/O
        // problem we must surface so operators see it (permissions,
        // ENOTDIR, EIO).
        if (code !== 'ENOENT') throw err;
      }
    }

    if (bytes !== null) {
      resultPath = payloadPath;
      resultDigest = createHash('sha256').update(bytes).digest('hex') as Sha256Hex;
      kind = 'data';
    } else {
      const receipt = await synthesizeReceipt(evidence, deps.payloadsRoot);
      resultPath = receipt.receiptPath;
      resultDigest = receipt.digest;
      kind = 'receipt';
    }
  }

  const grantId = (() => {
    const g = evidence.grantMetadata.grantId;
    if (typeof g === 'string' && g.length > 0 && !g.startsWith('NOT_APPLICABLE')) {
      return g as Uuid;
    }
    return null;
  })();

  const reference: NxsOutputReference = {
    outputReferenceId: newUuid(),
    runId: evidence.runId,
    // Tool-call sub-actions don't carry a parent node taskId; use the
    // action id so the mailbox item is one-to-one with the NXS dispatch.
    // Downstream callers should join through evidenceRecordId when they
    // need to walk back to the originating plan node.
    //
    // Multi-node planner: nxs_dispatch node owners pass `taskIdOverride:
    // node.nodeId` so the mailbox item is addressable by the planner's
    // nodeId via MailboxService.findBySlot.
    taskId: deps.taskIdOverride ?? evidence.actionId,
    agentId: evidence.actionSummary.actorId,
    slotId: deps.slotId ?? ('nxs_result' as NonEmpty),
    sourceType: 'nxs_execution_result',
    resultRef: `file://${resultPath}` as NonEmpty,
    resultDigest,
    // Spec §7.3 — propagate the connector's declared `dataClass` so the
    // mailbox eligibility check passes for `classificationRequired: true`
    // mailboxes. The connector manifest is the single authoritative source
    // for the data classification of this target; the caller resolves it
    // from the same lookup the orchestrator already binds against, so this
    // is not widening or inventing — it's threading the declared label
    // through the result path.
    resultClassifications: [deps.targetDataClass],
    octLevel: deps.agentOctLevel,
    createdAt: new Date().toISOString() as IsoTimestamp,
    redactionState: 'not_required',
    evidenceRecordId: evidence.recordId,
    executionGrantId: grantId,
    finalOutcome: evidence.finalOutcome,
  };

  const writeCtx = {
    runId: reference.runId,
    producerActorId: reference.agentId,
    mailboxId: deps.mailboxId,
    taskId: reference.taskId,
    slotId: reference.slotId,
  };
  const mailboxItem = await deps.outputCollector.writeMailboxItemFromNxsResult(reference, writeCtx);
  return { mailboxItem, payloadPath: resultPath, resultDigest, kind };
}

interface SynthesizedReceipt {
  readonly receiptPath: string;
  readonly digest: Sha256Hex;
}

/**
 * Write a small receipt JSON derived from the EvidenceRecord into the same
 * per-run payload directory so it can be referenced by file://. Receipts
 * are sibling files to data payloads ('<actionId>.receipt.json') so a
 * directory listing distinguishes them at a glance.
 */
async function synthesizeReceipt(
  evidence: EvidenceRecord,
  payloadsRoot: string
): Promise<SynthesizedReceipt> {
  const exec = evidence.executionResult!;
  const dir = path.join(payloadsRoot, evidence.runId);
  await fs.mkdir(dir, { recursive: true });
  const receiptPath = path.join(dir, `${evidence.actionId}.receipt.json`);

  const receipt = {
    kind: 'nxs_receipt',
    actionId: evidence.actionId,
    runId: evidence.runId,
    executedAt: exec.executedAt,
    status: exec.status,
    responseCode: exec.responseCode,
    durationMs: exec.durationMs,
    redactedSummary: exec.redactedSummary,
    errorType: exec.errorType,
    errorMessage: exec.errorMessage,
    finalOutcome: evidence.finalOutcome,
  };

  const body = JSON.stringify(receipt, null, 2);
  await fs.writeFile(receiptPath, body, { encoding: 'utf-8', mode: 0o600 });
  const digest = createHash('sha256').update(body).digest('hex') as Sha256Hex;
  return { receiptPath, digest };
}

/**
 * Synthesize a denial receipt for the case where Gate 06 never ran (the
 * pipeline denied at Gates 01–05 or operated in observe/advisory mode).
 *
 * Inputs the evidence record's `finalOutcome` + the first non-allow,
 * non-pass `gateDecisions[]` entry to surface the deciding gate, its
 * `denialCode`, `reason`, and `policyRuleId`. Compile reads this file
 * during assembly so the run's final response can explain WHY NXS
 * refused the action, rather than silently dropping the node.
 *
 * The file is written as a sibling of the data + (success-but-no-data)
 * receipt files, with the `.denial-receipt.json` suffix so a directory
 * listing distinguishes all three at a glance.
 */
async function synthesizeDenialReceipt(
  evidence: EvidenceRecord,
  payloadsRoot: string
): Promise<SynthesizedReceipt> {
  const dir = path.join(payloadsRoot, evidence.runId);
  await fs.mkdir(dir, { recursive: true });
  const receiptPath = path.join(dir, `${evidence.actionId}.denial-receipt.json`);

  // Find the deciding gate — the first GateDecision whose outcome is
  // neither 'pass' nor 'allow'. Covers 'deny' and 'error' explicitly and
  // any future outcome that is not a positive admission.
  const decidingGate =
    evidence.gateDecisions.find(d => d.outcome !== 'pass' && d.outcome !== 'allow') ?? null;

  const denialReceipt = {
    kind: 'nxs_denial_receipt',
    actionId: evidence.actionId,
    runId: evidence.runId,
    evidenceRecordId: evidence.recordId,
    finalOutcome: evidence.finalOutcome,
    decidingGateId: decidingGate?.gateId ?? null,
    decidingGateOutcome: decidingGate?.outcome ?? null,
    decidedAt: decidingGate?.evaluatedAt ?? null,
    denialCode: decidingGate?.denialCode ?? null,
    denialReason: decidingGate?.reason ?? evidence.finalOutcome,
    policyRuleId: decidingGate?.policyRuleId ?? null,
  };

  const body = JSON.stringify(denialReceipt, null, 2);
  await fs.writeFile(receiptPath, body, { encoding: 'utf-8', mode: 0o600 });
  const digest = createHash('sha256').update(body).digest('hex') as Sha256Hex;
  return { receiptPath, digest };
}
