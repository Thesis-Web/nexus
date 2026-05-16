// packages/planners/db-lexicon/src/db-lexicon-chat.integration.test.ts
//
// AMEND-nexus-planner-chat-tier-v0-2-0.md §9.3 — Branch 0 chat tier
// end-to-end through `RefRunCoordinator` + `MailboxServiceImpl` + a real
// signed lexicon fixture load (so the planner is fully constructed).
// Three scenarios:
//
//   CHAT-INT-01: chat happy path. A `WorkspaceManifestRecord` with
//     entryMode 'free_chat' drives `buildPlannerRequestForWorkspace` to
//     emit a ChatPlannerRequest; the coordinator runs Branch 0 → 1-node
//     plan; trace.branch === 'chat'; rejection: null.
//
//   CHAT-INT-02: server-side tier override. The workspace.entryMode is
//     the signed source of truth. We construct a WorkspaceRunRequest the
//     same way the route does, then assert the derived PlannerRequest
//     carries tier 'chat' regardless of any UI-supplied hint.
//
//   CHAT-INT-03: chat rejection + Accept-Suggestions reissue (symmetric
//     to Branch 3 §3.10 reuse). Operator picks an agent missing
//     synthesize:content; planChatBranch returns a RejectionCheckbackPayload
//     with `recommendedSelectedAgentIds`. Operator then submits a new
//     WorkspaceRunRequest with `checkbackSourceRunId` set and
//     `selectedAgentIds` swapped to the recommended; the new run
//     completes with branch 'chat' + plan_created.
//
// Only the dispatcher + LLM transport are stubbed (governance pipeline
// + real connector calls live outside this test's scope).

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalize } from '@nexus/runtime-utils';
import type {
  AgentCapabilityEntry,
  AgentRegistryReader,
  ChatPlannerRequest,
  MailboxBackend,
  MailboxItem,
  MailboxManifestRecord,
  NonEmpty,
  OrchestratorManifestRecord,
  OrchestratorPlanPreview,
  RunLedgerEntry,
  RunLedgerWriter,
  Sha256Hex,
  Uuid,
  WorkspaceManifestRecord,
  WorkspaceRunRequest,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import {
  RefDagExecutor,
  RefRunCoordinator,
  buildPlannerRequestForWorkspace,
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
const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004' as Uuid;
const CHAT_AGENT_2_ID = '00000000-0000-4000-a000-000000000041' as Uuid;
const SALES_AGENT_ID = '00000000-0000-4000-a000-000000000031' as Uuid;

const CHAT_AGENT: AgentCapabilityEntry = {
  agentId: CHAT_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['synthesize:content' as NonEmpty],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const CHAT_AGENT_2: AgentCapabilityEntry = {
  agentId: CHAT_AGENT_2_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['synthesize:content' as NonEmpty],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const SALES_AGENT: AgentCapabilityEntry = {
  agentId: SALES_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['read:record:single' as NonEmpty, 'query:data' as NonEmpty],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const ALL_AGENTS: AgentCapabilityEntry[] = [CHAT_AGENT, CHAT_AGENT_2, SALES_AGENT];

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
  mailboxId: 'chat-mailbox' as NonEmpty,
  mailboxType: 'jsonl-file' as NonEmpty,
  enabled: true,
  required: true,
  storageRoot: 'runs/mailbox-chat' as NonEmpty,
  retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
  classificationRequired: false,
  digestRequired: true,
  configuration: {},
};

function makeOrchManifest(): OrchestratorManifestRecord {
  return {
    orchestratorSocketId: 'chat-orch' as NonEmpty,
    orchestratorType: 'reference_deterministic' as NonEmpty,
    enabled: true,
    orchestratorActorId: ORCHESTRATOR_ACTOR_ID,
    plannerMode: 'deterministic_first',
    maxSplitDepth: 1,
    planCheckbackDefault: false,
    secureMode: {
      octSecureDefault: 'single_agent_no_helper',
      allowSecureMultiAgentOnlyBySignedPolicy: false,
    },
    retryPolicy: { transientAutoRetryCount: 0 },
    timeouts: { systemActionMs: 60_000, modelCallMs: 60_000 },
    outputSlotPolicy: 'advisory_declared_slots',
    configuration: {},
    plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
    plannerVersion: '0.1.0' as NonEmpty,
    plannerConfiguration: {},
    planAmendment: { enabled: false, maxAmendments: 0, requiresCheckback: false },
    partialCompletion: {
      enabled: false,
      minRequiredCompletedNodes: 0,
      compileOnPartial: false,
    },
    maxToolTurnsPerNode: 1,
  } as OrchestratorManifestRecord;
}

const CHAT_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'nexus-chat-default' as NonEmpty,
  workspaceType: 'chat_workspace' as NonEmpty,
  enabled: true,
  entryMode: 'free_chat',
  baseUrl: 'http://localhost:4100/chat' as NonEmpty,
  returnEndpointId: 'reference-workspace-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: false, finalDisplay: true, fileSpace: false },
  configuration: { defaultChatAgentId: CHAT_AGENT_ID },
};

function makeRunRequest(overrides: Partial<WorkspaceRunRequest> = {}): WorkspaceRunRequest {
  return {
    runId: randomUUID() as Uuid,
    userId: 'integ-user' as NonEmpty,
    principalId: randomUUID() as Uuid,
    authenticatedBy: 'integ-test' as NonEmpty,
    enteredAt: nowIso(),
    prompt: 'Who are you?' as NonEmpty,
    promptDigest: 'a'.repeat(64) as Sha256Hex,
    promptRef: null,
    selectedAgentIds: [CHAT_AGENT_ID],
    workspaceSocketId: 'nexus-chat-default' as NonEmpty,
    planCheckbackRequested: false,
    preferredEndpointId: null,
    attachedFiles: [],
    subTasks: null,
    subTaskEdges: null,
    checkbackSourceRunId: null,
    ...overrides,
  };
}

interface CoordinatorHarness {
  coordinator: RefRunCoordinator;
  ledger: ReturnType<typeof ledgerWriter>;
  planner: DbLexiconTransformerPlanner;
}

async function makeCoordinator(tables: LexiconTablesV1): Promise<CoordinatorHarness> {
  const manifest = makeOrchManifest();
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
        completionMetadata: { result: 'I am a chat assistant.' },
        failureReason: null,
        governanceDenied: false,
      })
    ),
    issueDelegation: vi.fn(async () => randomUUID() as Uuid),
    triggerCompile: vi.fn(async () => {}),
    sendPlanCheckback: vi.fn(async () => true),
    buildPlannerRequest: (request: WorkspaceRunRequest) =>
      buildPlannerRequestForWorkspace({
        request,
        workspace: CHAT_WORKSPACE,
        nowIso: () => nowIso(),
      }),
    agentRegistry: REGISTRY,
    capabilityCeiling: [],
    maxSplitDepth: 1,
  };

  const coordinator = new RefRunCoordinator(manifest, deps, ORCHESTRATOR_ACTOR_ID);
  return { coordinator, ledger, planner };
}

let tables: LexiconTablesV1;

beforeAll(async () => {
  tables = await loadLexiconFixtures({
    fixtureRoot: FIXTURE_ROOT,
    controlPlanePublicKey: DEV_PUBLIC_KEY,
  });
});

describe('db-lexicon chat integration — Scenario CHAT-INT-01: happy path', () => {
  it('chat happy path produces a 1-node nvg_dispatch plan via real RefRunCoordinator', async () => {
    const request = makeRunRequest({ selectedAgentIds: [CHAT_AGENT_ID] });
    const { coordinator, planner, ledger } = await makeCoordinator(tables);

    const preview: OrchestratorPlanPreview = await coordinator.handleRun(request);
    expect(preview.rejection).toBeNull();
    expect(preview.plan).not.toBeNull();
    if (!preview.plan) return;
    expect(preview.plan.nodes).toHaveLength(1);
    expect(preview.plan.edges).toHaveLength(0);
    expect(preview.plan.nodes[0]!.nodeType).toBe('nvg_dispatch');
    expect(preview.plan.nodes[0]!.agentId).toBe(CHAT_AGENT_ID);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('chat');
    expect(trace?.preflightOutcome).toBe('preferred_agents_satisfy');
    expect(trace?.planOutcome).toBe('plan_created');

    // Ledger sanity: plan_created event was written by the coordinator.
    const planCreated = ledger.events.find(e => e.eventType === 'plan_created');
    expect(planCreated).toBeDefined();
  });
});

describe('db-lexicon chat integration — Scenario CHAT-INT-02: server-side tier override', () => {
  it('builder derives tier "chat" from workspace.entryMode regardless of any UI hint', () => {
    // WorkspaceRunRequest carries no client tier field; the builder
    // reads workspace.entryMode (signed manifest) and emits the right
    // PlannerRequest type. This pins the discriminator behavior.
    const request = makeRunRequest({ selectedAgentIds: [CHAT_AGENT_ID] });
    const result = buildPlannerRequestForWorkspace({
      request,
      workspace: CHAT_WORKSPACE,
      nowIso: () => nowIso(),
    });
    expect(result.tier).toBe('chat');
    if (result.tier !== 'chat') throw new Error('narrow failed');
    const chat = result as ChatPlannerRequest;
    expect(chat.selectedAgentIds).toEqual([CHAT_AGENT_ID]);
    expect(chat.workspaceSocketId).toBe('nexus-chat-default');
  });
});

describe('db-lexicon chat integration — Scenario CHAT-INT-03: rejection + Accept-Suggestions reissue', () => {
  it('rejection with symmetric checkback → reissue with recommended agent completes successfully', async () => {
    // First run: operator picks SALES_AGENT (no synthesize:content) →
    // planChatBranch rejects with RejectionCheckbackPayload.
    const firstRequest = makeRunRequest({ selectedAgentIds: [SALES_AGENT_ID] });
    const { coordinator: c1, planner: p1, ledger: l1 } = await makeCoordinator(tables);
    const firstPreview = await c1.handleRun(firstRequest);
    expect(firstPreview.plan).toBeNull();
    expect(firstPreview.rejection).not.toBeNull();
    const checkback = firstPreview.rejection;
    if (!checkback) return;
    expect(checkback.missingCapabilities).toEqual(['synthesize:content']);
    expect(checkback.recommendedSelectedAgentIds.length).toBeGreaterThan(0);

    const trace1 = p1.getLastTrace();
    expect(trace1?.branch).toBe('chat');
    expect(trace1?.preflightOutcome).toBe('preferred_agents_insufficient_alternatives_suggested');

    // Verify the coordinator wrote plan_checkback_sent with the
    // checkbackPayload so the workspace UI's reducer can extract it.
    const checkbackEvent = l1.events.find(e => e.eventType === 'plan_checkback_sent');
    expect(checkbackEvent).toBeDefined();

    // Second run: operator accepts → workspace closes the first run
    // and opens a new run with selectedAgentIds = recommended, plus
    // checkbackSourceRunId pointing at the rejected runId. This is the
    // Accept-Suggestions flow that lexicon V1 Commit 8 built; chat
    // reuses it unchanged per §3.10.
    const recommendedAgent = checkback.recommendedSelectedAgentIds[0] as Uuid;
    const secondRequest = makeRunRequest({
      selectedAgentIds: [recommendedAgent],
      checkbackSourceRunId: firstRequest.runId,
    });
    const { coordinator: c2, planner: p2 } = await makeCoordinator(tables);
    const secondPreview = await c2.handleRun(secondRequest);
    expect(secondPreview.rejection).toBeNull();
    expect(secondPreview.plan).not.toBeNull();
    if (!secondPreview.plan) return;
    expect(secondPreview.plan.nodes).toHaveLength(1);
    expect(secondPreview.plan.nodes[0]!.agentId).toBe(recommendedAgent);
    expect(p2.getLastTrace()?.branch).toBe('chat');
    expect(p2.getLastTrace()?.planOutcome).toBe('plan_created');
  });
});
