// packages/planners/db-lexicon/src/db-lexicon-planner.integration.test.ts
//
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.2 integration test.
// Drives `DbLexiconTransformerPlanner` through a real `RefRunCoordinator`
// + `RefDagExecutor` + `MailboxServiceImpl` end-to-end, covering the
// three §9.2 scenarios:
//
//   1. Lexical decomposition (Branch 4) — warehouse worked example
//      produces a 3-node plan (nxs read → nvg compute → nxs write).
//   2. Preflight pass (Branch 3) — operator's preferred agent
//      satisfies the required capabilities; plan emits with preferred
//      agent.
//   3. Preflight reject + counter-suggest (Branch 3) — operator's
//      preferred agent doesn't cover a required capability; planner
//      rejects with executable counter-suggestion; coordinator emits
//      `plan_rejected` + `planner_plan_trace` + `plan_checkback_sent`
//      (with `RejectionCheckbackPayload` in detail.checkbackPayload);
//      `OrchestratorPlanPreview.rejection` is populated.
//
// Only the dispatcher + LLM transport are stubbed (governance pipeline
// + connectors live outside this test's scope per §9.2 wording: "Mock
// connector + LLM transport"). Everything else — coordinator, planner,
// mailbox service, ledger, agent registry — is real.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { canonicalize } from '@nexus/runtime-utils';
import type {
  AgentCapabilityEntry,
  AgentRegistryReader,
  ExecutionPlan,
  MailboxBackend,
  MailboxItem,
  MailboxManifestRecord,
  MetadataPlannerRequest,
  NonEmpty,
  NormalPlannerRequest,
  OrchestratorManifestRecord,
  OrchestratorPlanPreview,
  PlannerRequest,
  RunLedgerEntry,
  RunLedgerWriter,
  Sha256Hex,
  Uuid,
  WorkspaceRunRequest,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import {
  RefDagExecutor,
  RefRunCoordinator,
  type NodeDispatchResult,
  type RunCoordinatorDeps,
} from '@nexus/orch-ref';
import { MailboxServiceImpl } from '../../../core/src/mailbox/mailbox-service.js';
import { DbLexiconTransformerPlanner } from './db-lexicon-planner.js';
import { loadLexiconFixtures } from './internal/fixture-loader.js';
import type { LexiconTablesV1 } from './internal/types.js';

const FIXTURE_ROOT = 'fixtures/planner/db-lexicon';
const DEV_PUBLIC_KEY = 'zlwFwfovYQTY85H2DIy1jbFgBpNP868RH0As5bbLb4A';

const ORCHESTRATOR_ACTOR_ID = '00000000-0000-4000-a000-000000000001' as Uuid;
const WAREHOUSE_AGENT_ID = '00000000-0000-4000-8000-0000000000a1' as Uuid;
const SALES_AGENT_ID = '00000000-0000-4000-8000-0000000000a2' as Uuid;

const WAREHOUSE_AGENT: AgentCapabilityEntry = {
  agentId: WAREHOUSE_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: [
    'read:record:single' as NonEmpty,
    'read:record:bulk' as NonEmpty,
    'query:data' as NonEmpty,
    'search:data' as NonEmpty,
    'update:record:internal' as NonEmpty,
  ],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const SALES_AGENT: AgentCapabilityEntry = {
  agentId: SALES_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: [
    'read:record:single' as NonEmpty,
    'query:data' as NonEmpty,
    'search:data' as NonEmpty,
  ],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const ALL_AGENTS: AgentCapabilityEntry[] = [WAREHOUSE_AGENT, SALES_AGENT];

const REGISTRY: AgentRegistryReader = {
  async findByCapability(cap: NonEmpty): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS.filter(a => a.capabilities.includes(cap));
  },
  async getById(id: Uuid): Promise<AgentCapabilityEntry | null> {
    return ALL_AGENTS.find(a => a.agentId === id) ?? null;
  },
  async listVisible(_ceiling: NonEmpty[]): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS;
  },
};

function computeDigest(obj: unknown): Sha256Hex {
  return createHash('sha256').update(canonicalize(obj), 'utf-8').digest('hex') as Sha256Hex;
}

function fakeBackend(): MailboxBackend {
  const store: MailboxItem[] = [];
  return {
    write: async (input): Promise<MailboxItem> => {
      const item: MailboxItem = {
        mailboxItemId: randomUUID() as Uuid,
        mailboxId: input.mailboxId,
        runId: input.runId,
        taskId: input.taskId,
        slotId: input.slotId,
        sourceType: input.sourceType,
        outputType: input.outputType,
        sourceRef: input.sourceRef,
        sourceDigest: input.sourceDigest,
        producerActorId: input.producerActorId,
        principalId: input.principalId,
        riskTier: input.riskTier,
        ingestedAt: nowIso(),
        mailboxStatus: 'ingested',
        redactionState: 'open',
        agentId: input.agentId,
        classifiedAt: nowIso(),
        blockedReason: null,
      };
      store.push(item);
      return item;
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

const MAILBOX_MANIFEST: MailboxManifestRecord = {
  mailboxId: 'mbx-primary' as NonEmpty,
  mailboxType: 'local-jsonl' as NonEmpty,
  enabled: true,
  required: true,
  storageRoot: 'runs/mailbox' as NonEmpty,
  retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
  classificationRequired: false,
  digestRequired: false,
  configuration: {},
};

function makeManifest(): OrchestratorManifestRecord {
  return {
    orchestratorSocketId: 'ref-orch-v1' as NonEmpty,
    orchestratorType: 'reference_deterministic' as NonEmpty,
    enabled: true,
    orchestratorActorId: ORCHESTRATOR_ACTOR_ID,
    plannerMode: 'deterministic_first',
    maxSplitDepth: 3,
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
    plannerVersion: '0.1.0' as NonEmpty,
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

interface CoordinatorHarness {
  coordinator: RefRunCoordinator;
  ledger: ReturnType<typeof ledgerWriter>;
  planner: DbLexiconTransformerPlanner;
}

async function makeCoordinator(
  buildPlannerRequest: (request: WorkspaceRunRequest) => PlannerRequest,
  tables: LexiconTablesV1
): Promise<CoordinatorHarness> {
  const manifest = makeManifest();
  const backend = fakeBackend();
  const ledger = ledgerWriter();
  const mailboxService = new MailboxServiceImpl(backend, MAILBOX_MANIFEST, ledger);
  const planner = new DbLexiconTransformerPlanner(tables, computeDigest, ORCHESTRATOR_ACTOR_ID);
  const executor = new RefDagExecutor({ enabled: false, minRequiredCompletedNodes: 0 });

  const deps: RunCoordinatorDeps = {
    planner,
    dagExecutor: executor,
    runLedgerWriter: ledger,
    mailboxService,
    outputCollector: {
      collect: vi.fn(),
      resolve: vi.fn(),
    } as unknown as RunCoordinatorDeps['outputCollector'],
    computeDigest,
    dispatchToGovernance: vi.fn(
      async (): Promise<NodeDispatchResult> => ({
        success: true,
        completionMetadata: { result: 'ok' },
        failureReason: null,
        governanceDenied: false,
      })
    ),
    issueDelegation: vi.fn(async () => randomUUID() as Uuid),
    triggerCompile: vi.fn(async () => {}),
    sendPlanCheckback: vi.fn(async () => true),
    buildPlannerRequest,
    agentRegistry: REGISTRY,
    capabilityCeiling: [],
    maxSplitDepth: 3,
  };

  const coordinator = new RefRunCoordinator(manifest, deps, ORCHESTRATOR_ACTOR_ID);
  return { coordinator, ledger, planner };
}

function makeRunRequest(overrides: Partial<WorkspaceRunRequest> = {}): WorkspaceRunRequest {
  return {
    runId: randomUUID() as Uuid,
    userId: 'integ-user' as NonEmpty,
    principalId: randomUUID() as Uuid,
    authenticatedBy: 'integ-test' as NonEmpty,
    enteredAt: nowIso(),
    prompt: 'pull the warehouse inventory and adjust it from receiving today' as NonEmpty,
    promptDigest: 'a'.repeat(64) as Sha256Hex,
    promptRef: null,
    selectedAgentIds: [],
    workspaceSocketId: 'ws-integ' as NonEmpty,
    planCheckbackRequested: false,
    preferredEndpointId: null,
    attachedFiles: [],
    subTasks: null,
    subTaskEdges: null,
    checkbackSourceRunId: null,
    ...overrides,
  };
}

let tables: LexiconTablesV1;

beforeAll(async () => {
  tables = await loadLexiconFixtures({
    fixtureRoot: FIXTURE_ROOT,
    controlPlanePublicKey: DEV_PUBLIC_KEY,
  });
});

// ─── Scenario 1: Lexical decomposition (Branch 4) ───

describe('db-lexicon planner integration — Scenario 1: lexical decomposition (Branch 4)', () => {
  it('warehouse worked example produces a 3-node plan via real RefRunCoordinator', async () => {
    const request = makeRunRequest();
    const buildPlannerRequest = (wsr: WorkspaceRunRequest): PlannerRequest =>
      ({
        tier: 'normal' as const,
        runId: wsr.runId,
        userId: wsr.userId,
        principalId: wsr.principalId,
        prompt: wsr.prompt,
        selectedAgentIds: wsr.selectedAgentIds,
        requiredCapabilities: [],
        edgeHints: [],
        workspaceSocketId: wsr.workspaceSocketId,
        planCheckbackRequested: wsr.planCheckbackRequested,
        enteredAt: wsr.enteredAt,
        preferredEndpointId: wsr.preferredEndpointId,
        subTasks: null,
        subTaskEdges: null,
      }) as NormalPlannerRequest;
    const { coordinator, ledger, planner } = await makeCoordinator(buildPlannerRequest, tables);

    const preview: OrchestratorPlanPreview = await coordinator.handleRun(request);
    expect(preview.plan).not.toBeNull();
    if (!preview.plan) return;
    expect(preview.plan.nodes.length).toBe(3);
    expect(preview.rejection).toBeNull();

    // Trace stashed by the planner; coordinator emits the
    // planner_plan_trace ledger event from it
    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('lexical_decomposition');
    expect(trace?.planOutcome).toBe('plan_created');

    // Coordinator-side ledger events fired in the expected sequence
    const eventTypes = ledger.events.map(e => e.eventType);
    expect(eventTypes).toContain('planner_plan_trace');
    expect(eventTypes).toContain('plan_created');
  });
});

// ─── Scenario 2: Preflight pass (Branch 3) ───

describe('db-lexicon planner integration — Scenario 2: preflight pass (Branch 3)', () => {
  it('preferred warehouse-agent satisfies the required capabilities; plan emits with preferred agent', async () => {
    const request = makeRunRequest({ selectedAgentIds: [WAREHOUSE_AGENT_ID] });
    const buildPlannerRequest = (wsr: WorkspaceRunRequest): PlannerRequest =>
      ({
        tier: 'normal' as const,
        runId: wsr.runId,
        userId: wsr.userId,
        principalId: wsr.principalId,
        prompt: wsr.prompt,
        selectedAgentIds: wsr.selectedAgentIds,
        requiredCapabilities: [
          'read:record:single' as NonEmpty,
          'update:record:internal' as NonEmpty,
        ],
        edgeHints: [],
        workspaceSocketId: wsr.workspaceSocketId,
        planCheckbackRequested: wsr.planCheckbackRequested,
        enteredAt: wsr.enteredAt,
        preferredEndpointId: wsr.preferredEndpointId,
        subTasks: null,
        subTaskEdges: null,
      }) as NormalPlannerRequest;
    const { coordinator, ledger, planner } = await makeCoordinator(buildPlannerRequest, tables);

    const preview = await coordinator.handleRun(request);
    expect(preview.plan).not.toBeNull();
    expect(preview.rejection).toBeNull();

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('preflight_preferred_agents');
    expect(trace?.preflightOutcome).toBe('preferred_agents_satisfy');
    expect(trace?.planOutcome).toBe('plan_created');

    const eventTypes = ledger.events.map(e => e.eventType);
    expect(eventTypes).toContain('planner_plan_trace');
    expect(eventTypes).toContain('plan_created');
    expect(eventTypes).not.toContain('plan_checkback_sent');
  });
});

// ─── Scenario 3: Preflight reject + counter-suggest (Branch 3) ───

describe('db-lexicon planner integration — Scenario 3: preflight reject + counter-suggest (Branch 3)', () => {
  it('sales-agent missing update:record:internal — rejection + checkback payload + preview.rejection populated', async () => {
    const request = makeRunRequest({ selectedAgentIds: [SALES_AGENT_ID] });
    const buildPlannerRequest = (wsr: WorkspaceRunRequest): PlannerRequest =>
      ({
        tier: 'normal' as const,
        runId: wsr.runId,
        userId: wsr.userId,
        principalId: wsr.principalId,
        prompt: wsr.prompt,
        selectedAgentIds: wsr.selectedAgentIds,
        requiredCapabilities: [
          'read:record:single' as NonEmpty,
          'update:record:internal' as NonEmpty,
        ],
        edgeHints: [],
        workspaceSocketId: wsr.workspaceSocketId,
        planCheckbackRequested: wsr.planCheckbackRequested,
        enteredAt: wsr.enteredAt,
        preferredEndpointId: wsr.preferredEndpointId,
        subTasks: null,
        subTaskEdges: null,
      }) as NormalPlannerRequest;
    const { coordinator, ledger, planner } = await makeCoordinator(buildPlannerRequest, tables);

    const preview = await coordinator.handleRun(request);
    expect(preview.plan).toBeNull();
    expect(preview.rejection).not.toBeNull();
    expect(preview.rejection?.reason).toBe('no_capable_agent');
    expect(preview.rejection?.missingCapabilities).toContain('update:record:internal');
    expect(preview.rejection?.recommendedSelectedAgentIds).toContain(WAREHOUSE_AGENT_ID);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('preflight_preferred_agents');
    expect(trace?.preflightOutcome).toBe('preferred_agents_insufficient_alternatives_suggested');
    expect(trace?.planOutcome).toBe('plan_rejected_no_capable_agent');

    // All three ledger events present per §9.2 scenario 3 assertions.
    // HL#4 canonical event name (legacy `plan_rejected` alias removed from
    // RunEventType 2026-05-23 — fix-spec post-consolidation).
    const eventTypes = ledger.events.map(e => e.eventType);
    expect(eventTypes).toContain('planner_infeasible');
    expect(eventTypes).toContain('planner_plan_trace');
    expect(eventTypes).toContain('plan_checkback_sent');

    // plan_checkback_sent event carries the full RejectionCheckbackPayload
    const checkback = ledger.events.find(e => e.eventType === 'plan_checkback_sent');
    expect(checkback?.detail?.['checkbackPayload']).toBeDefined();
    const payload = checkback?.detail?.['checkbackPayload'] as Record<string, unknown>;
    expect(payload['recommendedSelectedAgentIds']).toEqual([WAREHOUSE_AGENT_ID]);
    expect(payload['missingCapabilities']).toEqual(['update:record:internal']);
  });
});
