/**
 * Unit tests for the NXS-result → mailbox bridge.
 *
 * Cases:
 *  - Successful execution + payload file present → mailbox item written
 *    with kind:'data', correct digest, slot, source type, evidence linkage
 *  - Failed execution → mailbox item written with kind:'receipt' carrying
 *    the failure summary from EvidenceRecord
 *  - Successful execution but payload file missing (write-only outcome) →
 *    mailbox item written with kind:'receipt', status:'success'
 *  - executionResult === null → no mailbox write (returns null)
 *  - Custom slotId override is honored on both data + receipt paths
 *  - Sentinel grantId ('NOT_APPLICABLE') becomes null on the reference
 *  - resultRef carries a file:// URL pointing at the on-disk payload
 *  - I/O error other than ENOENT propagates (do not silently swallow)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { bridgeNxsResultToMailbox } from './nxs-result-mailbox-bridge.js';
import type {
  DataClass,
  EvidenceRecord,
  ExecutionResult,
  MailboxItem,
  NxsOutputReference,
  OutputCollector,
  Uuid,
  IsoTimestamp,
  NonEmpty,
} from '@nexus/contracts';
import { FINAL_OUTCOME } from '@nexus/contracts';

// ── Doubles ──────────────────────────────────────────────────────────────────

interface CollectorState {
  readonly writes: NxsOutputReference[];
}

function fakeCollector(): { collector: OutputCollector; state: CollectorState } {
  const writes: NxsOutputReference[] = [];
  const collector: OutputCollector = {
    async writeMailboxItemFromNvgResult(_input) {
      throw new Error('not used in NXS bridge tests');
    },
    async writeMailboxItemFromNxsResult(input) {
      writes.push(input);
      const item: MailboxItem = {
        mailboxItemId: '00000000-0000-4000-a000-000000000777' as Uuid,
        mailboxId: 'fake-mailbox' as NonEmpty,
        runId: input.runId,
        taskId: input.taskId,
        agentId: input.agentId,
        slotId: input.slotId,
        sourceType: input.sourceType,
        resultRef: input.resultRef,
        resultDigest: input.resultDigest,
        resultClassifications: input.resultClassifications,
        octLevel: input.octLevel,
        createdAt: input.createdAt,
        expiresAt: null,
        evidenceRecordId: input.evidenceRecordId,
        routingTrailRecordId: null,
        runLedgerEventId: null,
        redactionState: input.redactionState,
        mailboxStatus: 'available',
        compileEligible: true,
        consumedAt: null,
        blockedReason: null,
      };
      return item;
    },
    async writeMailboxItemFromAgentPartial(_input) {
      throw new Error('not used in NXS bridge tests');
    },
    async buildOutputContract() {
      throw new Error('not used in NXS bridge tests');
    },
  };
  return { collector, state: { writes } };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN_ID = '00000000-0000-4000-a000-000000000aaa' as Uuid;
const ACTION_ID = '00000000-0000-4000-a000-000000000bbb' as Uuid;
const ACTOR_ID = '00000000-0000-4000-a000-000000000031' as Uuid;
const RECORD_ID = '00000000-0000-4000-a000-000000000ccc' as Uuid;
const GRANT_ID = '00000000-0000-4000-a000-000000000ddd' as Uuid;

function makeEvidence(opts: {
  status?: ExecutionResult['status'];
  executionNull?: boolean;
  grantId?: string;
  errorType?: string | null;
  errorMessage?: string | null;
}): EvidenceRecord {
  const exec: ExecutionResult | null = opts.executionNull
    ? null
    : {
        grantId: GRANT_ID,
        executedAt: new Date().toISOString() as IsoTimestamp,
        status: opts.status ?? 'success',
        responseCode: opts.status === 'failure' ? '500' : '200',
        durationMs: 12,
        redactedSummary:
          opts.status === 'failure'
            ? '[postgres:test] denied: forbidden verb'
            : '[postgres:test] SELECT → 2 row(s); payload=...',
        errorType: opts.errorType ?? (opts.status === 'failure' ? 'FORBIDDEN_QUERY' : null),
        errorMessage:
          opts.errorMessage ?? (opts.status === 'failure' ? "verb 'DROP' is not permitted" : null),
      };
  return {
    recordId: RECORD_ID,
    actionId: ACTION_ID,
    sessionId: '00000000-0000-4000-a000-000000000eee' as Uuid,
    runId: RUN_ID,
    ledgerSequence: 1,
    actionSummary: {
      actionId: ACTION_ID,
      receivedAt: new Date().toISOString() as IsoTimestamp,
      protocol: 'test/v1',
      actorId: ACTOR_ID,
      actorClass: 'SUPERVISED_AGENT',
      actorEnvironment: 'reference' as NonEmpty,
      principalId: '00000000-0000-4000-a000-000000000030' as Uuid,
      delegationSequence: 1,
      tool: 'pg.query',
      resolvedVerb: 'read',
      resolvedCapability: 'read:record:bulk',
      resolvedTarget: {
        system: 'sales-finance' as NonEmpty,
        resourceType: 'record' as NonEmpty,
        resourceScope: 'bulk',
        environment: 'reference' as NonEmpty,
        externalFacing: false,
      },
      resolvedDataClasses: [],
      resolvedRiskTier: 'low',
    },
    intentEvidence: {
      objectiveSummary: 'test',
      triggeringSource: 'test',
      toolchainContext: 'test',
      modelId: null,
      modelConfidence: null,
      riskNote: null,
      extractedAt: new Date().toISOString() as IsoTimestamp,
    } as never,
    delegationContextSnapshot: {} as never,
    gateDecisions: [],
    policyRuleId: 'test-rule',
    policyOutcome: 'allow',
    approvalRequired: false,
    approvalRequest: null,
    approvalResponse: null,
    approvalDecisionLabel: 'NOT_APPLICABLE',
    grantMetadata: {
      grantId: (opts.grantId ?? GRANT_ID) as never,
      scopeDescriptor: 'test' as NonEmpty,
      credentialSubjectId: 'test' as NonEmpty,
      credentialSubjectType: 'service_identity',
      issuedAt: new Date().toISOString() as IsoTimestamp,
      expiresAt: new Date(Date.now() + 60_000).toISOString() as IsoTimestamp,
      expiryClass: 'action_scoped',
      templateFingerprint: 'a'.repeat(64) as never,
      approvalLinkage: 'NOT_APPLICABLE' as never,
    },
    executionResult: exec,
    finalOutcome: opts.status === 'failure' ? FINAL_OUTCOME.DENIED_OTHER : FINAL_OUTCOME.EXECUTED,
    threatEvents: [],
    compilerView: {} as never,
    previousHash: '0'.repeat(64) as never,
    recordHash: '1'.repeat(64) as never,
    signature: 's'.repeat(86) as never,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let payloadsRoot: string;

beforeEach(async () => {
  payloadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-bridge-'));
});

afterEach(async () => {
  await fs.rm(payloadsRoot, { recursive: true, force: true });
});

async function writePayload(content: string): Promise<string> {
  const dir = path.join(payloadsRoot, RUN_ID);
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `${ACTION_ID}.json`);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('bridgeNxsResultToMailbox', () => {
  it('writes a data mailbox item when the execution succeeded and payload exists', async () => {
    const payloadContent = JSON.stringify({ rows: [{ x: 1 }, { x: 2 }], rowCount: 2 });
    const payloadPath = await writePayload(payloadContent);
    const { collector, state } = fakeCollector();

    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('data');
    expect(result!.payloadPath).toBe(payloadPath);
    expect(result!.resultDigest).toBe(createHash('sha256').update(payloadContent).digest('hex'));
    expect(state.writes).toHaveLength(1);
    const ref = state.writes[0]!;
    expect(ref.sourceType).toBe('nxs_execution_result');
    expect(ref.runId).toBe(RUN_ID);
    expect(ref.taskId).toBe(ACTION_ID);
    expect(ref.agentId).toBe(ACTOR_ID);
    expect(ref.slotId).toBe('nxs_result');
    expect(ref.evidenceRecordId).toBe(RECORD_ID);
    expect(ref.executionGrantId).toBe(GRANT_ID);
    expect(ref.resultRef).toBe(`file://${payloadPath}`);
    expect(ref.octLevel).toBe('OCT-OPEN');
    expect(ref.redactionState).toBe('not_required');
    expect(ref.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
    // Spec §7.3 regression — the bridge MUST propagate the connector's
    // declared dataClass into resultClassifications, so the mailbox
    // eligibility check passes for classificationRequired:true mailboxes.
    // Without this the item is correctly fail-closed-blocked and compile
    // sees `output_contract_empty`. Two callsites must thread it: the
    // bridge (here) and the orchestrator dispatcher (scripts/nexus-main.ts).
    expect(ref.resultClassifications).toEqual(['internal']);
    expect(result!.mailboxItem.mailboxItemId).toBe('00000000-0000-4000-a000-000000000777');
  });

  it('writes a receipt mailbox item when the execution failed', async () => {
    // No payload file written — the failure path should not depend on one
    // existing on disk. The connector typically does not write a payload
    // when status='failure'.
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'failure' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('receipt');
    expect(state.writes).toHaveLength(1);

    // Receipt file is at <runId>/<actionId>.receipt.json — distinguishable
    // from data payloads at the directory level.
    const receiptPath = path.join(payloadsRoot, RUN_ID, `${ACTION_ID}.receipt.json`);
    expect(result!.payloadPath).toBe(receiptPath);
    expect(state.writes[0]!.resultRef).toBe(`file://${receiptPath}`);

    // Receipt body carries the failure summary from the EvidenceRecord.
    const body = JSON.parse(await fs.readFile(receiptPath, 'utf-8'));
    expect(body.kind).toBe('nxs_receipt');
    expect(body.actionId).toBe(ACTION_ID);
    expect(body.runId).toBe(RUN_ID);
    expect(body.status).toBe('failure');
    expect(body.errorType).toBe('FORBIDDEN_QUERY');
    expect(body.errorMessage).toBe("verb 'DROP' is not permitted");
    expect(body.finalOutcome).toBe(FINAL_OUTCOME.DENIED_OTHER);

    // Digest matches the receipt bytes — round-trip callers verify this
    // when they re-read the file to feed the LLM, so it must line up.
    const expected = createHash('sha256')
      .update(JSON.stringify(body, null, 2))
      .digest('hex');
    expect(result!.resultDigest).toBe(expected);
    expect(state.writes[0]!.resultDigest).toBe(expected);

    // finalOutcome on the reference reflects the denial.
    expect(state.writes[0]!.finalOutcome).toBe(FINAL_OUTCOME.DENIED_OTHER);
  });

  it('writes a receipt mailbox item when the execution succeeded but no payload file exists', async () => {
    // Simulates a write-only success: INSERT/UPDATE/DELETE that returned
    // no rows. The connector marks status=success but doesn't write a
    // payload file because there's nothing to persist.
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('receipt');
    expect(state.writes).toHaveLength(1);

    const receiptPath = path.join(payloadsRoot, RUN_ID, `${ACTION_ID}.receipt.json`);
    expect(result!.payloadPath).toBe(receiptPath);

    const body = JSON.parse(await fs.readFile(receiptPath, 'utf-8'));
    expect(body.status).toBe('success');
    expect(body.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
    expect(body.errorType).toBeNull();
    expect(body.errorMessage).toBeNull();
  });

  it('returns null when executionResult is missing', async () => {
    await writePayload('{}');
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ executionNull: true }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
    });
    expect(result).toBeNull();
    expect(state.writes).toHaveLength(0);
  });

  it('honors a taskIdOverride so nxs_dispatch nodes are addressable by nodeId', async () => {
    const NODE_ID = '00000000-0000-4000-a000-00000000aaaa' as Uuid;
    await writePayload('{"rows":[],"rowCount":0}');
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
      taskIdOverride: NODE_ID,
    });
    // Without override the taskId would be evidence.actionId. With override
    // it MUST be the supplied nodeId so MailboxService.findBySlot lookups
    // by (runId, nodeId, slotId) succeed.
    expect(state.writes[0]!.taskId).toBe(NODE_ID);
  });

  it('honors a custom slotId on the data path', async () => {
    await writePayload('{"rows":[],"rowCount":0}');
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
      slotId: 'inventory_query' as NonEmpty,
    });
    expect(state.writes[0]!.slotId).toBe('inventory_query');
  });

  it('honors a custom slotId on the receipt path', async () => {
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'failure' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
      slotId: 'inventory_update' as NonEmpty,
    });
    expect(state.writes[0]!.slotId).toBe('inventory_update');
  });

  it('maps a sentinel grantId to null on the reference', async () => {
    await writePayload('{}');
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'success', grantId: 'NOT_APPLICABLE' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      mailboxId: 'mbx-test' as NonEmpty,
      targetDataClass: 'internal' as DataClass,
    });
    expect(state.writes[0]!.executionGrantId).toBeNull();
  });

  it('propagates non-ENOENT filesystem errors instead of swallowing them', async () => {
    // Make payloadsRoot unreadable for the run dir by pointing the helper at
    // a path where the per-run dir is a file rather than a directory — that
    // produces ENOTDIR on the readFile call.
    const trapDir = path.join(payloadsRoot, RUN_ID);
    await fs.writeFile(trapDir, 'not-a-dir', 'utf-8');
    const { collector } = fakeCollector();
    await expect(
      bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
        outputCollector: collector,
        payloadsRoot,
        agentOctLevel: 'OCT-OPEN',
      })
    ).rejects.toThrow();
  });
});
