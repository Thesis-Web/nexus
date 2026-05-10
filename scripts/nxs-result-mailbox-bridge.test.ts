/**
 * Unit tests for the NXS-result → mailbox bridge.
 *
 * Cases:
 *  - Successful execution + payload file present → mailbox item written
 *    with correct digest, slot, source type, evidence linkage
 *  - Failed execution → no mailbox write (returns null)
 *  - Missing payload file → no mailbox write, no throw (returns null)
 *  - executionResult === null → no mailbox write
 *  - Custom slotId override is honored
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
  EvidenceRecord,
  ExecutionResult,
  MailboxItem,
  NxsOutputReference,
  OutputCollector,
  Uuid,
  IsoTimestamp,
  NonEmpty,
} from '@nexus/contracts';

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
}): EvidenceRecord {
  const exec: ExecutionResult | null = opts.executionNull
    ? null
    : {
        grantId: GRANT_ID,
        executedAt: new Date().toISOString() as IsoTimestamp,
        status: opts.status ?? 'success',
        responseCode: '200',
        durationMs: 12,
        redactedSummary: '[postgres:test] SELECT → 2 row(s); payload=...',
        errorType: null,
        errorMessage: null,
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
    finalOutcome: opts.status === 'failure' ? 'denied_execution' : 'executed_successfully',
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
  it('writes a mailbox item when the execution succeeded and payload exists', async () => {
    const payloadContent = JSON.stringify({ rows: [{ x: 1 }, { x: 2 }], rowCount: 2 });
    const payloadPath = await writePayload(payloadContent);
    const { collector, state } = fakeCollector();

    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
    });

    expect(result).not.toBeNull();
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
    expect(ref.finalOutcome).toBe('executed_successfully');
    expect(result!.mailboxItem.mailboxItemId).toBe('00000000-0000-4000-a000-000000000777');
  });

  it('returns null and skips the write when execution failed', async () => {
    await writePayload('{}');
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'failure' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
    });
    expect(result).toBeNull();
    expect(state.writes).toHaveLength(0);
  });

  it('returns null when executionResult is missing', async () => {
    await writePayload('{}');
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ executionNull: true }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
    });
    expect(result).toBeNull();
    expect(state.writes).toHaveLength(0);
  });

  it('returns null when payload file is missing (no throw)', async () => {
    const { collector, state } = fakeCollector();
    const result = await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
    });
    expect(result).toBeNull();
    expect(state.writes).toHaveLength(0);
  });

  it('honors a custom slotId', async () => {
    await writePayload('{"rows":[],"rowCount":0}');
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'success' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
      slotId: 'inventory_query' as NonEmpty,
    });
    expect(state.writes[0]!.slotId).toBe('inventory_query');
  });

  it('maps a sentinel grantId to null on the reference', async () => {
    await writePayload('{}');
    const { collector, state } = fakeCollector();
    await bridgeNxsResultToMailbox(makeEvidence({ status: 'success', grantId: 'NOT_APPLICABLE' }), {
      outputCollector: collector,
      payloadsRoot,
      agentOctLevel: 'OCT-OPEN',
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
