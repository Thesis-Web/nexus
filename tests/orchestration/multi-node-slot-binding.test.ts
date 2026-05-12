/**
 * Multi-node slot-binding loop — end-to-end test.
 *
 * Composes real RefDeterministicPlanner + validateExecutionPlan +
 * RefRunCoordinator + RefDagExecutor + MailboxServiceImpl + the
 * composition-root resolver (resolveNxsSlotBindings). The only stub is
 * `dispatchToGovernance`, which mirrors what `dispatchNxsNode` does in
 * production (call the resolver, write a mailbox item via the
 * MailboxService) without standing up the full bootstrap, NXS gate
 * pipeline, or real connectors.
 *
 * Proves the warehouse-style worked example shape end-to-end:
 *
 *   subTasks: [ {kind:nxs, key:'read'}, {kind:nxs, key:'write'} ]
 *   write.actionTemplate.slotBindings reads 'units' out of read's mailbox
 *   item and writes it into write.rawPayload.set.units before dispatch.
 *
 * Assertion shape:
 *   - Plan is accepted (Check 15 passes for the well-formed binding).
 *   - Run completes; both nodes status=completed.
 *   - The payload the dispatcher observed for the WRITE node has
 *     set.units equal to the upstream read body's `units` field.
 */
import { describe, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  ExecutionPlan,
  PlanNode,
  OrchestratorManifestRecord,
  WorkspaceRunRequest,
  PlannerRequest,
  RunLedgerEntry,
  RunLedgerWriter,
  AgentCapabilityEntry,
  MailboxItem,
  MailboxBackend,
  MailboxManifestRecord,
  NxsOutputReference,
  OutputCollector as IOutputCollector,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';

import { RefRunCoordinator } from '@nexus/orch-ref';
import { RefDeterministicPlanner, evaluateCondition, RefDagExecutor } from '@nexus/orch-ref';
import type { NodeDispatchResult, RunCoordinatorDeps } from '@nexus/orch-ref';
import { MailboxServiceImpl } from '../../packages/core/src/mailbox/mailbox-service.js';
import { resolveNxsSlotBindings } from '../../scripts/nxs-slot-binding-resolver.js';

// ─── fixtures ───

function computeDigest(obj: unknown): Sha256Hex {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex') as Sha256Hex;
}

function fakeBackend(): MailboxBackend & { all(): MailboxItem[] } {
  const store: MailboxItem[] = [];
  return {
    backendId: 'fake' as NonEmpty,
    backendVersion: '0' as NonEmpty,
    all: () => [...store],
    write: async item => {
      store.push(item);
    },
    getById: async id => store.find(i => i.mailboxItemId === id) ?? null,
    listByRun: async query =>
      store.filter(i => i.mailboxId === query.mailboxId && i.runId === query.runId),
    updateStatus: async (id, next, reason) => {
      const idx = store.findIndex(i => i.mailboxItemId === id);
      if (idx >= 0) {
        store[idx] = { ...store[idx]!, mailboxStatus: next, blockedReason: reason };
      }
      return store[idx]!;
    },
  };
}

function ledgerWriter(): RunLedgerWriter & {
  events: Array<Omit<RunLedgerEntry, 'entryId'>>;
} {
  const events: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    events,
    writeEvent: vi.fn(async (entry: Omit<RunLedgerEntry, 'entryId'>) => {
      events.push(entry);
    }),
    getByRunId: vi.fn(async () => []),
    tail: vi.fn(async () => []),
    getLatestRunId: vi.fn(async () => null),
  };
}

const MAILBOX_ID = 'mbx-primary' as NonEmpty;
const MAILBOX_MANIFEST: MailboxManifestRecord = {
  mailboxId: MAILBOX_ID,
  mailboxType: 'local-jsonl' as NonEmpty,
  enabled: true,
  required: true,
  storageRoot: 'runs/mailbox' as NonEmpty,
  retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
  classificationRequired: false,
  digestRequired: false,
  configuration: {},
};

function makeManifest(orchestratorActorId: Uuid): OrchestratorManifestRecord {
  return {
    orchestratorSocketId: 'ref-orch-v1' as NonEmpty,
    orchestratorType: 'ref-deterministic' as NonEmpty,
    enabled: true,
    orchestratorActorId,
    plannerMode: 'deterministic_first',
    maxSplitDepth: 10,
    planCheckbackDefault: false,
    secureMode: {
      octSecureDefault: 'single_agent_no_helper',
      allowSecureMultiAgentOnlyBySignedPolicy: false,
    },
    retryPolicy: { transientAutoRetryCount: 0 },
    timeouts: { systemActionMs: 30000, modelCallMs: 60000 },
    outputSlotPolicy: 'advisory_declared_slots',
    configuration: {},
    plannerType: 'ref-deterministic' as NonEmpty,
    plannerVersion: '1.0.0' as NonEmpty,
    plannerConfiguration: {},
    planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
    partialCompletion: {
      enabled: false,
      minRequiredCompletedNodes: 0,
      compileOnPartial: false,
    },
    maxToolTurnsPerNode: 6,
  } as OrchestratorManifestRecord;
}

function makeAgent(agentId: Uuid): AgentCapabilityEntry {
  return {
    agentId,
    actorClass: 'ai_agent' as NonEmpty,
    capabilities: ['read:warehouse:inventory' as NonEmpty, 'write:warehouse:inventory' as NonEmpty],
    octTier: 'oct_open' as NonEmpty,
    environment: 'development' as NonEmpty,
    enabled: true,
  };
}

// ─── the test ───

describe('multi-node slot-binding loop (end-to-end)', () => {
  it('writes the upstream NXS read body into the downstream NXS write payload via slotBindings', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-node-slot-binding-'));
    const orchestratorActorId = randomUUID() as Uuid;
    const agentId = randomUUID() as Uuid;
    const runId = randomUUID() as Uuid;
    const principalId = randomUUID() as Uuid;
    const agent = makeAgent(agentId);

    // ── Real mailbox stack ──
    const backend = fakeBackend();
    const ledger = ledgerWriter();
    const mailboxService = new MailboxServiceImpl(backend, MAILBOX_MANIFEST, ledger);

    // ── Outputs observed by the test's dispatcher ──
    const observedDispatches: Array<{ nodeId: Uuid; rawPayload: unknown }> = [];

    // ── Custom dispatchToGovernance — mirrors dispatchNxsNode without
    //    the full bootstrap. For each nxs_dispatch node:
    //      1. Resolve slotBindings via the production resolver.
    //      2. Observe the resolved payload (the test asserts on this).
    //      3. Write a synthesized mailbox item so the next node's
    //         slot reads have something to find.
    //    Node 1 (read) has no upstream → resolver returns the raw payload.
    //    Its output is a JSON body shaped like a connector result. Node 2
    //    (write) reads node 1's body via sourceJsonPath; its resolved
    //    payload should contain set.units = 7. ──
    const dispatchToGovernance = async (
      node: PlanNode,
      _delegationId: Uuid,
      plan: ExecutionPlan
    ): Promise<NodeDispatchResult> => {
      const resolved = await resolveNxsSlotBindings({
        node,
        plan,
        mailboxService,
        mailboxId: MAILBOX_ID,
        runId,
      });
      if (!resolved.resolved) {
        return {
          success: false,
          completionMetadata: null,
          failureReason: ('slot_binding_resolve_failed: ' + resolved.reason) as NonEmpty,
          governanceDenied: false,
        };
      }
      observedDispatches.push({ nodeId: node.nodeId, rawPayload: resolved.payload });

      // Synthesize the mailbox item for THIS node so downstream reads
      // succeed. The body content discriminates by subTaskKey so the
      // assertion can verify the slot binding pulled from the right item.
      const slotId = (node.expectedOutputSlots[0] ?? 'default') as NonEmpty;
      let body: string;
      if (node.subTaskKey === 'read') {
        body = JSON.stringify({ product: 'A', units: 7 });
      } else {
        // write: the receipt
        body = JSON.stringify({
          status: 'success',
          updatedRows: 1,
          finalUnits: (resolved.payload as { set: { units: number } }).set.units,
        });
      }
      const payloadPath = path.join(tmpDir, `${node.nodeId}-${slotId}.json`);
      await fs.writeFile(payloadPath, body, 'utf-8');
      const digest = createHash('sha256').update(body).digest('hex') as Sha256Hex;

      const reference: NxsOutputReference = {
        outputReferenceId: randomUUID() as Uuid,
        runId,
        taskId: node.nodeId,
        agentId: node.agentId,
        slotId,
        sourceType: 'nxs_execution_result',
        resultRef: ('file://' + payloadPath) as NonEmpty,
        resultDigest: digest,
        resultClassifications: [],
        octLevel: 'OCT-OPEN',
        createdAt: nowIso(),
        redactionState: 'not_required',
        evidenceRecordId: null,
        executionGrantId: null,
        finalOutcome: 'executed_successfully',
      };

      const item = await mailboxService.writeFromOutput({
        mailboxId: MAILBOX_ID,
        output: reference,
        expiresAt: null,
        runLedgerEventId: null,
      });

      return {
        success: true,
        completionMetadata: { mailboxItemId: item.mailboxItemId },
        failureReason: null,
        governanceDenied: false,
      };
    };

    // ── Coordinator deps (mostly real) ──
    const planner = new RefDeterministicPlanner(computeDigest, orchestratorActorId);
    const dagExecutor = new RefDagExecutor({ enabled: false, minRequiredCompletedNodes: 0 });
    const registry = {
      findByCapability: vi.fn(async (cap: NonEmpty) =>
        agent.capabilities.includes(cap) ? [agent] : []
      ),
      getById: vi.fn(async (id: Uuid) => (id === agentId ? agent : null)),
      listVisible: vi.fn(async () => [agent]),
    };
    const triggerCompile = vi.fn(async () => {
      // Coordinator may still call this on success; the test does not
      // exercise compile here — that's a separate test surface.
    });
    const deps: RunCoordinatorDeps = {
      planner,
      dagExecutor,
      runLedgerWriter: ledger,
      mailboxService,
      outputCollector: {} as IOutputCollector, // not used on this path
      computeDigest,
      dispatchToGovernance,
      issueDelegation: async () => randomUUID() as Uuid,
      triggerCompile,
      sendPlanCheckback: async () => true,
      buildPlannerRequest: (request: WorkspaceRunRequest): PlannerRequest => ({
        tier: 'normal' as const,
        runId: request.runId,
        userId: request.userId,
        principalId: request.principalId,
        prompt: request.prompt,
        selectedAgentIds: [],
        requiredCapabilities: [],
        edgeHints: [],
        workspaceSocketId: request.workspaceSocketId,
        planCheckbackRequested: request.planCheckbackRequested,
        enteredAt: request.enteredAt,
        preferredEndpointId: request.preferredEndpointId,
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'read' as NonEmpty,
            agentId,
            taskSummary: 'Read product A from inventory' as NonEmpty,
            expectedOutputSlots: ['warehouse_data' as NonEmpty],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:warehouse:inventory' as NonEmpty,
              target: {
                system: 'warehouse' as NonEmpty,
                resourceType: 'inventory' as NonEmpty,
                resourceScope: 'product_a' as NonEmpty,
              },
              rawPayload: {
                query: 'SELECT * FROM inventory WHERE product = $1',
                params: ['A'],
              },
            },
          },
          {
            kind: 'nxs',
            subTaskKey: 'write' as NonEmpty,
            agentId,
            taskSummary: 'Write adjusted units back to inventory' as NonEmpty,
            expectedOutputSlots: ['write_receipt' as NonEmpty],
            inputSlotReads: [
              { fromSubTaskKey: 'read' as NonEmpty, slotId: 'warehouse_data' as NonEmpty },
            ],
            actionTemplate: {
              capability: 'write:warehouse:inventory' as NonEmpty,
              target: {
                system: 'warehouse' as NonEmpty,
                resourceType: 'inventory' as NonEmpty,
                resourceScope: 'product_a' as NonEmpty,
              },
              rawPayload: {
                table: 'inventory',
                set: { units: -1 },
                where: { product: 'A' },
              },
              slotBindings: [
                {
                  fromSubTaskKey: 'read' as NonEmpty,
                  slotId: 'warehouse_data' as NonEmpty,
                  payloadPath: 'set.units' as NonEmpty,
                  sourceJsonPath: 'units' as NonEmpty,
                },
              ],
            },
          },
        ],
        subTaskEdges: [
          {
            sourceSubTaskKey: 'read' as NonEmpty,
            targetSubTaskKey: 'write' as NonEmpty,
            edgeType: 'data_dependency',
            conditionSpec: null,
            outputSlotRef: 'warehouse_data' as NonEmpty,
          },
        ],
      }),
      agentRegistry: registry,
      capabilityCeiling: [
        'read:warehouse:inventory' as NonEmpty,
        'write:warehouse:inventory' as NonEmpty,
      ],
      maxSplitDepth: 10,
    };

    const coordinator = new RefRunCoordinator(
      makeManifest(orchestratorActorId),
      deps,
      orchestratorActorId
    );

    const request: WorkspaceRunRequest = {
      runId,
      userId: 'user-1' as NonEmpty,
      principalId,
      authenticatedBy: 'ref-identity' as NonEmpty,
      enteredAt: nowIso(),
      prompt: 'pull product A and adjust units' as NonEmpty,
      promptDigest: computeDigest({ prompt: 'pull product A and adjust units' }),
      promptRef: null,
      selectedAgentIds: [agentId],
      workspaceSocketId: 'ref-workspace-v1' as NonEmpty,
      planCheckbackRequested: false,
      preferredEndpointId: null,
      attachedFiles: [],
      subTasks: null,
      subTaskEdges: null,
    };

    const preview = await coordinator.handleRun(request);

    expect(preview.plan).not.toBeNull();
    expect(preview.plan!.nodes).toHaveLength(2);

    // Both nodes completed
    const nodeCompletedEvents = ledger.events.filter(e => e.eventType === 'node_completed');
    expect(nodeCompletedEvents).toHaveLength(2);

    // The dispatcher observed both nodes
    expect(observedDispatches).toHaveLength(2);
    const writeDispatch = observedDispatches.find(d => {
      const node = preview.plan!.nodes.find(n => n.nodeId === d.nodeId);
      return node?.subTaskKey === 'write';
    });
    expect(writeDispatch).toBeDefined();
    expect(writeDispatch!.rawPayload).toEqual({
      table: 'inventory',
      set: { units: 7 },
      where: { product: 'A' },
    });

    // Compile would be triggered for a successful DAG
    expect(triggerCompile).toHaveBeenCalledOnce();

    // Mailbox saw both writes
    expect(backend.all()).toHaveLength(2);

    // Sanity: evaluateCondition export is wired through orch-ref so a
    // future consumer can still pull both the planner factory + the
    // condition evaluator from the same module surface.
    expect(typeof evaluateCondition).toBe('function');
  });

  it('fails the WRITE node cleanly when the upstream slot item is missing', async () => {
    // Negative path — no upstream item ever lands in the mailbox, so the
    // resolver returns `upstream_slot_item_missing` and the dispatcher
    // surfaces it as a typed NodeDispatchResult failure. The dag-executor
    // then marks the downstream node failed/skipped per existing law.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-node-slot-binding-missing-'));
    const orchestratorActorId = randomUUID() as Uuid;
    const agentId = randomUUID() as Uuid;
    const runId = randomUUID() as Uuid;
    const principalId = randomUUID() as Uuid;
    const agent = makeAgent(agentId);

    const backend = fakeBackend();
    const ledger = ledgerWriter();
    const mailboxService = new MailboxServiceImpl(backend, MAILBOX_MANIFEST, ledger);

    const failures: string[] = [];

    // Dispatcher: succeed the READ but with NO mailbox write (so the
    // downstream slot read misses) — mimics "read happened but evidence
    // had no executionResult." WRITE is then expected to fail at
    // resolver time.
    const dispatchToGovernance = async (
      node: PlanNode,
      _delegationId: Uuid,
      plan: ExecutionPlan
    ): Promise<NodeDispatchResult> => {
      if (node.subTaskKey === 'read') {
        return {
          success: true,
          completionMetadata: { mailboxItemId: null },
          failureReason: null,
          governanceDenied: false,
        };
      }
      // write: try to resolve
      const resolved = await resolveNxsSlotBindings({
        node,
        plan,
        mailboxService,
        mailboxId: MAILBOX_ID,
        runId,
      });
      expect(resolved.resolved).toBe(false);
      if (!resolved.resolved) {
        failures.push(resolved.reason);
        return {
          success: false,
          completionMetadata: null,
          failureReason: ('slot_binding_resolve_failed: ' + resolved.reason) as NonEmpty,
          governanceDenied: false,
        };
      }
      return {
        success: false,
        completionMetadata: null,
        failureReason: 'unreachable' as NonEmpty,
        governanceDenied: false,
      };
    };

    const planner = new RefDeterministicPlanner(computeDigest, orchestratorActorId);
    const dagExecutor = new RefDagExecutor({ enabled: false, minRequiredCompletedNodes: 0 });
    const registry = {
      findByCapability: vi.fn(async () => [agent]),
      getById: vi.fn(async (id: Uuid) => (id === agentId ? agent : null)),
      listVisible: vi.fn(async () => [agent]),
    };
    const deps: RunCoordinatorDeps = {
      planner,
      dagExecutor,
      runLedgerWriter: ledger,
      mailboxService,
      outputCollector: {} as IOutputCollector,
      computeDigest,
      dispatchToGovernance,
      issueDelegation: async () => randomUUID() as Uuid,
      triggerCompile: vi.fn(async () => {}),
      sendPlanCheckback: async () => true,
      buildPlannerRequest: (request: WorkspaceRunRequest): PlannerRequest => ({
        tier: 'normal' as const,
        runId: request.runId,
        userId: request.userId,
        principalId: request.principalId,
        prompt: request.prompt,
        selectedAgentIds: [],
        requiredCapabilities: [],
        edgeHints: [],
        workspaceSocketId: request.workspaceSocketId,
        planCheckbackRequested: request.planCheckbackRequested,
        enteredAt: request.enteredAt,
        preferredEndpointId: request.preferredEndpointId,
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'read' as NonEmpty,
            agentId,
            taskSummary: 'read' as NonEmpty,
            expectedOutputSlots: ['warehouse_data' as NonEmpty],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:warehouse:inventory' as NonEmpty,
              target: {
                system: 'warehouse' as NonEmpty,
                resourceType: 'inventory' as NonEmpty,
                resourceScope: 'product_a' as NonEmpty,
              },
              rawPayload: {},
            },
          },
          {
            kind: 'nxs',
            subTaskKey: 'write' as NonEmpty,
            agentId,
            taskSummary: 'write' as NonEmpty,
            expectedOutputSlots: ['write_receipt' as NonEmpty],
            inputSlotReads: [
              { fromSubTaskKey: 'read' as NonEmpty, slotId: 'warehouse_data' as NonEmpty },
            ],
            actionTemplate: {
              capability: 'write:warehouse:inventory' as NonEmpty,
              target: {
                system: 'warehouse' as NonEmpty,
                resourceType: 'inventory' as NonEmpty,
                resourceScope: 'product_a' as NonEmpty,
              },
              rawPayload: { set: { units: -1 } },
              slotBindings: [
                {
                  fromSubTaskKey: 'read' as NonEmpty,
                  slotId: 'warehouse_data' as NonEmpty,
                  payloadPath: 'set.units' as NonEmpty,
                  sourceJsonPath: null,
                },
              ],
            },
          },
        ],
        subTaskEdges: [
          {
            sourceSubTaskKey: 'read' as NonEmpty,
            targetSubTaskKey: 'write' as NonEmpty,
            edgeType: 'data_dependency',
            conditionSpec: null,
            outputSlotRef: 'warehouse_data' as NonEmpty,
          },
        ],
      }),
      agentRegistry: registry,
      capabilityCeiling: [
        'read:warehouse:inventory' as NonEmpty,
        'write:warehouse:inventory' as NonEmpty,
      ],
      maxSplitDepth: 10,
    };

    const coordinator = new RefRunCoordinator(
      makeManifest(orchestratorActorId),
      deps,
      orchestratorActorId
    );
    const request: WorkspaceRunRequest = {
      runId,
      userId: 'user-1' as NonEmpty,
      principalId,
      authenticatedBy: 'ref-identity' as NonEmpty,
      enteredAt: nowIso(),
      prompt: 'x' as NonEmpty,
      promptDigest: computeDigest({ prompt: 'x' }),
      promptRef: null,
      selectedAgentIds: [agentId],
      workspaceSocketId: 'ref-workspace-v1' as NonEmpty,
      planCheckbackRequested: false,
      preferredEndpointId: null,
      attachedFiles: [],
      subTasks: null,
      subTaskEdges: null,
    };

    await coordinator.handleRun(request);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('upstream_slot_item_missing');

    const nodeFailedEvents = ledger.events.filter(e => e.eventType === 'node_failed');
    expect(nodeFailedEvents.length).toBeGreaterThanOrEqual(1);
    // tmpDir kept on disk for ENOENT inspection if test fails — vitest
    // tmp cleanup is the runner's job, not ours.
    void tmpDir;
  });
});
