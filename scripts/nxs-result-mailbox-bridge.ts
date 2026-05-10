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
 * Returns null when:
 *   - executionResult is missing or status !== 'success' (the connector
 *     did not produce data — receipt-only mailbox items are a separate
 *     follow-up; for now we keep the failure trail in the evidence ledger
 *     without polluting the mailbox).
 *   - the payload file does not exist on disk (the connector path is by
 *     convention; not all connectors emit one).
 *
 * Layer note: this file lives at the composition boundary (scripts/),
 * mirroring extract-tool-calls.ts. Pure, side-effect contained to the
 * mailbox write + a single file read.
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
   * node's expectedOutputSlots[0] for cleaner DAG slot routing.
   */
  readonly slotId?: NonEmpty;
}

export interface BridgeResult {
  readonly mailboxItem: MailboxItem;
  readonly payloadPath: string;
  readonly resultDigest: Sha256Hex;
}

/**
 * Build an NxsOutputReference from an EvidenceRecord + the on-disk payload
 * file the connector wrote, then write a mailbox item via the composition-
 * root OutputCollector. Returns null when there is no payload to bridge.
 */
export async function bridgeNxsResultToMailbox(
  evidence: EvidenceRecord,
  deps: BridgeDeps
): Promise<BridgeResult | null> {
  const exec = evidence.executionResult;
  if (exec === null) return null;
  if (exec.status !== 'success') return null;

  const payloadPath = path.join(deps.payloadsRoot, evidence.runId, `${evidence.actionId}.json`);

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(payloadPath);
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOENT') return null;
    throw err;
  }

  const resultDigest = createHash('sha256').update(bytes).digest('hex') as Sha256Hex;

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
    taskId: evidence.actionId,
    agentId: evidence.actionSummary.actorId,
    slotId: deps.slotId ?? ('nxs_result' as NonEmpty),
    sourceType: 'nxs_execution_result',
    resultRef: `file://${payloadPath}` as NonEmpty,
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

  const mailboxItem = await deps.outputCollector.writeMailboxItemFromNxsResult(reference);
  return { mailboxItem, payloadPath, resultDigest };
}
