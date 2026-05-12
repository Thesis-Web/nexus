// packages/orch-ref/src/orch-lifecycle.test.ts
// AMEND-spec-nexus-orch §9, §10 — Orch Lifecycle + Assembly Tests
// Gates: ORCH-15, ORCH-16, ORCH-17, ORCH-23

import { describe, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  PlanNode,
  ExecutionPlan,
  PlanRejection,
  RunDagState,
  OrchestratorPlanPreview,
  OrchestratorManifestRecord,
  WorkspaceRunRequest,
  Planner,
  PlannerRequest,
  PlannerContext,
  Orchestrator,
  RunLedgerWriter,
  RunLedgerEntry,
  MailboxService,
  OutputCollector,
} from '@nexus/contracts';

import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

import { RefOrchestrator } from './ref-orchestrator.js';
import { RefRunCoordinator } from './run-coordinator.js';
import type { RunCoordinatorDeps, DelegationScope } from './run-coordinator.js';
import { RefDagExecutor } from './dag-executor.js';
import type { NodeDispatchResult } from './dag-executor.js';
import { evaluateCondition } from './condition-evaluator.js';
import {
  planFromSubTasks,
  planOctSecure,
  planStandard,
  type PlanAssemblyDeps,
} from './plan-assembly.js';
import type {
  AgentCapabilityEntry,
  MetadataPlannerRequest,
  NormalPlannerRequest,
} from '@nexus/contracts';

// ─── StubPlanner ───
//
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 6 — local test
// stub replacing `RefDeterministicPlanner` after its deletion.
// Delegates directly to the extracted `plan-assembly` primitives so
// these coordinator-lifecycle tests stay focused on coordinator
// behavior (event sequencing, dispatch, compile-trigger) rather than
// planner internals. The new `DbLexiconTransformerPlanner` is the
// production planner; orch-ref unit tests use this thin stub to avoid
// a layer-up dependency on `@nexus/planner-db-lexicon`.

class StubPlanner implements Planner {
  readonly plannerType: NonEmpty = 'test-stub' as NonEmpty;
  readonly plannerVersion: NonEmpty = '0.0.0' as NonEmpty;

  constructor(
    private readonly computeDigestFn: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid
  ) {}

  async plan(
    request: PlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    const deps: PlanAssemblyDeps = {
      computeDigest: this.computeDigestFn,
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
      orchestratorActorId: this.orchestratorActorId,
    };
    if (request.tier === 'oct_secure') return planOctSecure(request, context, deps);
    const reqNM = request as NormalPlannerRequest | MetadataPlannerRequest;
    if (reqNM.subTasks && reqNM.subTasks.length > 0) {
      return planFromSubTasks(reqNM, context, deps);
    }
    return planStandard(reqNM, context, deps);
  }
}

// ─── Helpers ───

function uuid(): Uuid {
  return randomUUID() as Uuid;
}

function computeDigest(obj: unknown): Sha256Hex {
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json).digest('hex') as Sha256Hex;
}

const orchestratorActorId = uuid();

function makeManifest(): OrchestratorManifestRecord {
  return {
    orchestratorSocketId: 'ref-orch-v1' as NonEmpty,
    orchestratorType: 'reference_deterministic' as NonEmpty,
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
    plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
    plannerVersion: '1.0.0' as NonEmpty,
    plannerConfiguration: {},
    planAmendment: {
      enabled: true,
      maxAmendments: 3,
      requiresCheckback: false,
    },
    partialCompletion: {
      enabled: false,
      minRequiredCompletedNodes: 0,
      compileOnPartial: false,
    },
    maxToolTurnsPerNode: 6,
  } as OrchestratorManifestRecord;
}

function makeRequest(agentIds: Uuid[]): WorkspaceRunRequest {
  const runId = uuid();
  return {
    runId,
    userId: 'user-1' as NonEmpty,
    principalId: uuid(),
    authenticatedBy: 'ref-identity' as NonEmpty,
    enteredAt: nowIso(),
    prompt: 'test prompt' as NonEmpty,
    promptDigest: computeDigest({ prompt: 'test prompt' }),
    promptRef: null,
    selectedAgentIds: agentIds,
    workspaceSocketId: 'ref-workspace-v1' as NonEmpty,
    planCheckbackRequested: false,
    preferredEndpointId: null,
    attachedFiles: [],
    subTasks: null,
    subTaskEdges: null,
  };
}

function makeAgent(agentId: Uuid): AgentCapabilityEntry {
  return {
    agentId,
    actorClass: 'ai_agent' as NonEmpty,
    capabilities: ['default' as NonEmpty],
    octTier: 'oct_open' as NonEmpty,
    environment: 'development' as NonEmpty,
    enabled: true,
  };
}

function makeLedgerWriter(): RunLedgerWriter & { events: Array<Omit<RunLedgerEntry, 'entryId'>> } {
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

function buildCoordinatorDeps(
  overrides: Partial<RunCoordinatorDeps> = {},
  agents: AgentCapabilityEntry[] = []
): RunCoordinatorDeps {
  const planner = new StubPlanner(computeDigest, orchestratorActorId);
  const executor = new RefDagExecutor({ enabled: false, minRequiredCompletedNodes: 0 });
  const ledgerWriter = makeLedgerWriter();

  const registry = {
    findByCapability: vi.fn(async (cap: NonEmpty) =>
      agents.filter(a => a.capabilities.includes(cap))
    ),
    getById: vi.fn(async (id: Uuid) => agents.find(a => a.agentId === id) ?? null),
    listVisible: vi.fn(async () => agents),
  };

  return {
    planner: overrides.planner ?? planner,
    dagExecutor: overrides.dagExecutor ?? executor,
    runLedgerWriter: overrides.runLedgerWriter ?? ledgerWriter,
    mailboxService: {
      // Legacy mock surface — unused by these coordinator unit tests but
      // retained for shape compat with older callsites.
      deliver: vi.fn(),
      consume: vi.fn(),
      ack: vi.fn(),
      // Mailbox-pit V1 — AMEND-nexus-mailbox-pit-v0-2-1 §3.2. Coordinator
      // calls allocateForRun in step 3.6; provide a no-op that returns an
      // empty map so the coordinator path doesn't throw. The lifecycle
      // tests do not exercise dispatch (the dispatcher is stubbed below),
      // so the empty allocation map is harmless.
      allocateForRun: vi.fn(async () => new Map<Uuid, NonEmpty>()),
      getMailboxForActor: vi.fn(async () => null),
      listMailboxesForRun: vi.fn(async () => new Map<Uuid, NonEmpty>()),
      resolveMailboxProvenance: vi.fn(async () => null),
      assertMailboxBelongsToActor: vi.fn(async () => undefined),
    } as unknown as MailboxService,
    outputCollector: { collect: vi.fn(), resolve: vi.fn() } as unknown as OutputCollector,
    computeDigest,
    dispatchToGovernance:
      overrides.dispatchToGovernance ??
      vi.fn(
        async (): Promise<NodeDispatchResult> => ({
          success: true,
          completionMetadata: { result: 'ok' },
          failureReason: null,
          governanceDenied: false,
        })
      ),
    issueDelegation: overrides.issueDelegation ?? vi.fn(async () => uuid()),
    triggerCompile: overrides.triggerCompile ?? vi.fn(async () => {}),
    sendPlanCheckback: vi.fn(async () => true),
    buildPlannerRequest:
      overrides.buildPlannerRequest ??
      ((request: WorkspaceRunRequest): PlannerRequest => ({
        tier: 'normal' as const,
        runId: request.runId,
        userId: request.userId,
        principalId: request.principalId,
        prompt: request.prompt,
        selectedAgentIds: request.selectedAgentIds,
        requiredCapabilities: request.selectedAgentIds.length > 0 ? [] : ['default' as NonEmpty],
        edgeHints: [],
        workspaceSocketId: request.workspaceSocketId,
        planCheckbackRequested: request.planCheckbackRequested,
        enteredAt: request.enteredAt,
        preferredEndpointId: request.preferredEndpointId,
      })),
    agentRegistry: overrides.agentRegistry ?? registry,
    capabilityCeiling: overrides.capabilityCeiling ?? [],
    maxSplitDepth: overrides.maxSplitDepth ?? 10,
  };
}

// ─── ORCH-15: Full lifecycle ───

describe('ORCH-15: Full lifecycle', () => {
  it('request → plan → dispatch → collect → compile_triggered', async () => {
    const agentId = uuid();
    const agent = makeAgent(agentId);
    const manifest = makeManifest();
    const deps = buildCoordinatorDeps({}, [agent]);
    const coordinator = new RefRunCoordinator(manifest, deps, orchestratorActorId);
    const orch = new RefOrchestrator('ref-orch-v1' as NonEmpty, '1.0.0' as NonEmpty, coordinator);

    const request = makeRequest([agentId]);
    const preview = await orch.dispatch(request);

    expect(preview.runId).toBe(request.runId);
    expect(preview.plan).not.toBeNull();
    expect(preview.selectedAgents).toHaveLength(1);

    // triggerCompile should have been called (all nodes succeeded)
    expect(deps.triggerCompile).toHaveBeenCalledWith(request.runId);
  });

  it('compile_skipped does NOT call triggerCompile', async () => {
    const agentId = uuid();
    const agent = makeAgent(agentId);
    const manifest = makeManifest();
    const deps = buildCoordinatorDeps(
      {
        dispatchToGovernance: vi.fn(
          async (): Promise<NodeDispatchResult> => ({
            success: false,
            completionMetadata: null,
            failureReason: 'agent_error' as NonEmpty,
            governanceDenied: false,
          })
        ),
      },
      [agent]
    );
    const coordinator = new RefRunCoordinator(manifest, deps, orchestratorActorId);
    const orch = new RefOrchestrator('ref-orch-v1' as NonEmpty, '1.0.0' as NonEmpty, coordinator);

    const request = makeRequest([agentId]);
    await orch.dispatch(request);

    // All nodes failed — compile should be skipped
    expect(deps.triggerCompile).not.toHaveBeenCalled();
  });
});

// ─── ORCH-16: Run Ledger events ───

describe('ORCH-16: Run Ledger events', () => {
  it('emits events in correct sequence for successful run', async () => {
    const agentId = uuid();
    const agent = makeAgent(agentId);
    const manifest = makeManifest();
    const ledger = makeLedgerWriter();
    const deps = buildCoordinatorDeps({ runLedgerWriter: ledger }, [agent]);
    const coordinator = new RefRunCoordinator(manifest, deps, orchestratorActorId);
    const orch = new RefOrchestrator('ref-orch-v1' as NonEmpty, '1.0.0' as NonEmpty, coordinator);

    const request = makeRequest([agentId]);
    await orch.dispatch(request);

    const eventTypes = ledger.events.map(e => e.eventType);

    // Expected sequence: plan_created → plan_confirmed → delegation_issued →
    // node events → dag_completed → compile_triggered
    expect(eventTypes).toContain('plan_created');
    expect(eventTypes).toContain('plan_confirmed');
    expect(eventTypes).toContain('delegation_issued');
    expect(eventTypes).toContain('dag_completed');
    expect(eventTypes).toContain('compile_triggered');

    // plan_created must come before plan_confirmed
    const planCreatedIdx = eventTypes.indexOf('plan_created');
    const planConfirmedIdx = eventTypes.indexOf('plan_confirmed');
    expect(planCreatedIdx).toBeLessThan(planConfirmedIdx);

    // dag_completed must come before compile_triggered
    const dagCompletedIdx = eventTypes.indexOf('dag_completed');
    const compileTriggeredIdx = eventTypes.indexOf('compile_triggered');
    expect(dagCompletedIdx).toBeLessThan(compileTriggeredIdx);
  });

  it('emits compile_skipped + final_response + run_closed for failed DAG', async () => {
    const agentId = uuid();
    const agent = makeAgent(agentId);
    const manifest = makeManifest();
    const ledger = makeLedgerWriter();
    const deps = buildCoordinatorDeps(
      {
        runLedgerWriter: ledger,
        dispatchToGovernance: vi.fn(
          async (): Promise<NodeDispatchResult> => ({
            success: false,
            completionMetadata: null,
            failureReason: 'fail' as NonEmpty,
            governanceDenied: false,
          })
        ),
      },
      [agent]
    );
    const coordinator = new RefRunCoordinator(manifest, deps, orchestratorActorId);
    const orch = new RefOrchestrator('ref-orch-v1' as NonEmpty, '1.0.0' as NonEmpty, coordinator);

    const request = makeRequest([agentId]);
    await orch.dispatch(request);

    const eventTypes = ledger.events.map(e => e.eventType);

    expect(eventTypes).toContain('dag_failed');
    expect(eventTypes).toContain('compile_skipped');
    expect(eventTypes).toContain('final_response');
    expect(eventTypes).toContain('run_closed');
    expect(eventTypes).not.toContain('compile_triggered');
  });
});

// ─── ORCH-17: Two-level replacement ───

describe('ORCH-17: Two-level replacement', () => {
  it('whole-orch swap: custom Orchestrator replaces RefOrchestrator', async () => {
    // Custom orchestrator that returns a fixed preview
    const customPreview: OrchestratorPlanPreview = {
      runId: uuid(),
      orchestratorSocketId: 'custom-orch' as NonEmpty,
      orchestratorActorId: uuid(),
      plannerMode: 'deterministic',
      selectedAgents: [],
      requiresUserApproval: false,
      planDigest: 'custom-digest' as Sha256Hex,
      plan: null,
    };

    const customOrch: Orchestrator = {
      orchestratorSocketId: 'custom-orch' as NonEmpty,
      orchestratorVersion: '2.0.0' as NonEmpty,
      dispatch: vi.fn(async () => customPreview),
      cancel: vi.fn(async () => {}),
    };

    // The contract is the same — dispatch returns OrchestratorPlanPreview
    const request = makeRequest([]);
    const result = await customOrch.dispatch(request);

    expect(result.orchestratorSocketId).toBe('custom-orch');
    expect(customOrch.dispatch).toHaveBeenCalled();
  });

  it('planner-only swap: custom Planner plugged into RefRunCoordinator', async () => {
    const agentId = uuid();
    const agent = makeAgent(agentId);
    const manifest = makeManifest();

    // Custom planner that uses a different algorithm
    const customPlanner: Planner = {
      plannerType: 'custom-ml' as NonEmpty,
      plannerVersion: '3.0.0' as NonEmpty,
      plan: vi.fn(async (request: PlannerRequest, context: PlannerContext) => {
        // Custom logic — but returns same ExecutionPlan shape
        const nodeId = uuid();
        const nodes: PlanNode[] = [
          {
            nodeId,
            planOrderIndex: 0,
            agentId,
            taskSummary: 'custom-planned-task' as NonEmpty,
            requiresNvg: false,
            requiresNxs: true,
            nodeType: 'nxs_dispatch',
            declaredRiskHint: EVIDENCE_SENTINEL,
            expectedOutputSlots: ['default' as NonEmpty],
            timeoutMs: 30000,
          },
        ];
        const planId = uuid();
        const planDigest = computeDigest({
          planId,
          runId: request.runId,
          nodes,
          edges: [],
          plannerType: 'custom-ml',
          plannerVersion: '3.0.0',
        });
        return {
          planId,
          runId: request.runId,
          planDigest,
          nodes,
          edges: [],
          plannerType: 'custom-ml' as NonEmpty,
          plannerVersion: '3.0.0' as NonEmpty,
          createdAt: nowIso(),
        } satisfies ExecutionPlan;
      }),
    };

    const deps = buildCoordinatorDeps({ planner: customPlanner }, [agent]);
    const coordinator = new RefRunCoordinator(manifest, deps, orchestratorActorId);
    const orch = new RefOrchestrator('ref-orch-v1' as NonEmpty, '1.0.0' as NonEmpty, coordinator);

    const request = makeRequest([agentId]);
    const preview = await orch.dispatch(request);

    // Custom planner was invoked
    expect(customPlanner.plan).toHaveBeenCalled();
    // Plan preview was produced
    expect(preview.plan).not.toBeNull();
  });
});

// ─── ORCH-23: API cancel route ───

// Resolve route file from repo root (process.cwd() = repo root during vitest)
const ORCH_ROUTE_PATH = resolve(
  process.cwd(),
  'packages/interfaces/api/src/routes/orchestrator.ts'
);

describe('ORCH-23: API cancel route', () => {
  it('orchestrator route does not import @nexus/orch-ref or use RunDagState', () => {
    const content = readFileSync(ORCH_ROUTE_PATH, 'utf-8');

    // ORCH-19 + ORCH-23: must not import @nexus/orch-ref
    expect(content).not.toContain("from '@nexus/orch-ref'");
    expect(content).not.toContain('from "@nexus/orch-ref"');

    // Must not access RunDagState in code — comments documenting the
    // prohibition are acceptable, actual imports/types are not.
    const codeOnly = content
      .replace(/\/\/.*$/gm, '') // strip single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // strip multi-line comments
    expect(codeOnly).not.toContain('RunDagState');
  });

  it('orchestrator route imports Orchestrator from @nexus/contracts', () => {
    const content = readFileSync(ORCH_ROUTE_PATH, 'utf-8');

    // Must import Orchestrator type from contracts
    expect(content).toContain('Orchestrator');
    expect(content).toContain('@nexus/contracts');
  });

  it('cancel route calls orchestrator.cancel(runId)', () => {
    const content = readFileSync(ORCH_ROUTE_PATH, 'utf-8');

    // Cancel route must exist and call orchestrator.cancel
    expect(content).toContain('/orchestrator/cancel');
    expect(content).toContain('.cancel(');
  });
});
