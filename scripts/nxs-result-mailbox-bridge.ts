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
 * Returns null only when:
 *   - executionResult is null on the evidence (truly nothing happened — no
 *     receipt to synthesize, the audit record itself is the trail).
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
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
}

export interface BridgeResult {
  readonly mailboxItem: MailboxItem;
  /** Absolute path to the file the mailbox item references — either the
   * connector-emitted payload OR a synthesized receipt JSON. Round-trip
   * callers read this to build the next NVG turn's tool_result message. */
  readonly payloadPath: string;
  readonly resultDigest: Sha256Hex;
  /** Discriminates data vs receipt so callers can log + classify accordingly.
   * Both flow through the same OutputCollector entry point. */
  readonly kind: 'data' | 'receipt';
}

/**
 * Build an NxsOutputReference from an EvidenceRecord + the on-disk payload
 * file the connector wrote (or a synthesized receipt when no payload exists),
 * then write a mailbox item via the composition-root OutputCollector.
 *
 * Returns null only when evidence.executionResult is itself null — there is
 * nothing to receipt and the audit record holds the trail directly.
 */
export async function bridgeNxsResultToMailbox(
  evidence: EvidenceRecord,
  deps: BridgeDeps
): Promise<BridgeResult | null> {
  const exec = evidence.executionResult;
  if (exec === null) return null;

  const payloadPath = path.join(deps.payloadsRoot, evidence.runId, `${evidence.actionId}.json`);

  let bytes: Buffer | null = null;
  if (exec.status === 'success') {
    try {
      bytes = await fs.readFile(payloadPath);
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      // ENOENT is the expected miss for write-only successes — fall through
      // to receipt synthesis. Any other error is a real I/O problem we must
      // surface so operators see it (e.g. permissions, ENOTDIR, EIO).
      if (code !== 'ENOENT') throw err;
    }
  }

  let resultPath: string;
  let resultDigest: Sha256Hex;
  let kind: 'data' | 'receipt';

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
    // Connector currently does not classify; default to empty. Mailboxes
    // configured with classificationRequired=true will reject this — that
    // surfaces as a fail-closed write at the MailboxService layer, which
    // is correct: the operator must add classification on a sensitive DB
    // before writes can flow.
    resultClassifications: [],
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
