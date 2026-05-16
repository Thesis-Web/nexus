// packages/planners/db-lexicon/src/db-lexicon-planner.test.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.1, §9.5.
//
// Covers the four-branch tier dispatch (§3.3) end-to-end through the
// real signed lexicon fixtures + a test-only AgentRegistryReader:
//
//   - Branch 1: oct_secure single-node
//   - Branch 2: pre-resolved subTasks (parity with old class)
//   - Branch 3: preferred-agents preflight (pass + reject-with-suggestions)
//   - Branch 4: lexical decomposition (warehouse worked example)
//
// Plus trace + checkback stash semantics + §9.5 parity coverage for the
// old RefDeterministicPlanner tests via the extracted plan-assembly.

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize } from '@nexus/runtime-utils';
import type {
  AgentCapabilityEntry,
  AgentRegistryReader,
  ChatPlannerRequest,
  EdgeHint,
  ExecutionPlan,
  IsoTimestamp,
  MetadataPlannerRequest,
  NonEmpty,
  NormalPlannerRequest,
  OctSecurePlannerRequest,
  PlanRejection,
  PlannerContext,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { DbLexiconTransformerPlanner } from './db-lexicon-planner.js';
import { loadLexiconFixtures } from './internal/fixture-loader.js';
import type { LexiconTablesV1 } from './internal/types.js';

const FIXTURE_ROOT = 'fixtures/planner/db-lexicon';
const DEV_PUBLIC_KEY = 'zlwFwfovYQTY85H2DIy1jbFgBpNP868RH0As5bbLb4A';

const ORCHESTRATOR_ACTOR_ID = '00000000-0000-4000-a000-000000000001' as Uuid;
const WAREHOUSE_AGENT_ID = '00000000-0000-4000-8000-0000000000a1' as Uuid;
const SALES_AGENT_ID = '00000000-0000-4000-8000-0000000000a2' as Uuid;
const SECURE_AGENT_ID = '00000000-0000-4000-8000-0000000000a3' as Uuid;
const PRINCIPAL_ID = '00000000-0000-4000-8000-0000000000b1' as Uuid;
const RUN_ID = '00000000-0000-4000-8000-0000000000c1' as Uuid;

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

const SECURE_AGENT: AgentCapabilityEntry = {
  agentId: SECURE_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['read:record:single' as NonEmpty],
  octTier: 'OCT-SECURE' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const ALL_AGENTS: AgentCapabilityEntry[] = [WAREHOUSE_AGENT, SALES_AGENT, SECURE_AGENT];

const TEST_REGISTRY: AgentRegistryReader = {
  async findByCapability(capability: NonEmpty): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS.filter(a => a.capabilities.includes(capability));
  },
  async getById(agentId: Uuid): Promise<AgentCapabilityEntry | null> {
    return ALL_AGENTS.find(a => a.agentId === agentId) ?? null;
  },
  async listVisible(_ceiling: NonEmpty[]): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS;
  },
};

const TEST_CONTEXT: PlannerContext = {
  registry: TEST_REGISTRY,
  capabilityCeiling: [],
  maxSplitDepth: 3,
};

function computeDigest(obj: unknown): Sha256Hex {
  return createHash('sha256').update(canonicalize(obj), 'utf-8').digest('hex') as Sha256Hex;
}

function baseNormalRequest(overrides: Partial<NormalPlannerRequest> = {}): NormalPlannerRequest {
  return {
    tier: 'normal',
    runId: RUN_ID,
    userId: 'test-user' as NonEmpty,
    principalId: PRINCIPAL_ID,
    prompt: 'pull the warehouse inventory and adjust it from receiving today' as NonEmpty,
    selectedAgentIds: [],
    requiredCapabilities: [],
    edgeHints: [] as EdgeHint[],
    workspaceSocketId: 'workspace-ref' as NonEmpty,
    planCheckbackRequested: false,
    enteredAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
    preferredEndpointId: null,
    subTasks: null,
    subTaskEdges: null,
    checkbackSourceRunId: null,
    ...overrides,
  };
}

// ─── Test fixture: shared planner instance + tables ───

let tables: LexiconTablesV1;
let planner: DbLexiconTransformerPlanner;

beforeAll(async () => {
  tables = await loadLexiconFixtures({
    fixtureRoot: FIXTURE_ROOT,
    controlPlanePublicKey: DEV_PUBLIC_KEY,
  });
  planner = new DbLexiconTransformerPlanner(tables, computeDigest, ORCHESTRATOR_ACTOR_ID);
});

// ─── Planner identity ───

describe('DbLexiconTransformerPlanner — identity + interfaces', () => {
  it('exposes plannerType and plannerVersion per spec §3.2', () => {
    expect(planner.plannerType).toBe('db-lexicon-transformer-v0');
    expect(planner.plannerVersion).toBe('0.1.0');
  });

  it('implements PlannerTraceReader.getLastTrace() (null until first plan)', () => {
    const fresh = new DbLexiconTransformerPlanner(tables, computeDigest, ORCHESTRATOR_ACTOR_ID);
    expect(fresh.getLastTrace()).toBeNull();
  });

  it('implements PlannerCheckbackReader.getLastRejectionCheckback() (null until first plan)', () => {
    const fresh = new DbLexiconTransformerPlanner(tables, computeDigest, ORCHESTRATOR_ACTOR_ID);
    expect(fresh.getLastRejectionCheckback()).toBeNull();
  });

  it('exposes both reader interfaces via duck-typed property access', () => {
    expect('getLastTrace' in planner).toBe(true);
    expect('getLastRejectionCheckback' in planner).toBe(true);
    expect(typeof planner.getLastTrace).toBe('function');
    expect(typeof planner.getLastRejectionCheckback).toBe('function');
  });
});

// ─── Branch 1: oct_secure ───

describe('DbLexiconTransformerPlanner — Branch 1 oct_secure', () => {
  it('emits a single-node secure_handoff plan for the secure agent', async () => {
    const request: OctSecurePlannerRequest = {
      tier: 'oct_secure',
      runId: RUN_ID,
      userId: 'test-user' as NonEmpty,
      principalId: PRINCIPAL_ID,
      secureAgentId: SECURE_AGENT_ID,
      workspaceSocketId: 'workspace-ref' as NonEmpty,
      enteredAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
    };
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]!.nodeType).toBe('secure_agent_handoff');
    expect(plan.nodes[0]!.agentId).toBe(SECURE_AGENT_ID);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('oct_secure');
    expect(trace?.promptDigest).toBeNull();
    expect(trace?.planOutcome).toBe('plan_created');
  });
});

// ─── Branch 2: pre-resolved subTasks ───

describe('DbLexiconTransformerPlanner — Branch 2 pre-resolved subTasks', () => {
  it('passes through to plan-assembly.planFromSubTasks unchanged', async () => {
    const request = baseNormalRequest({
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'summarize' as NonEmpty,
          agentId: WAREHOUSE_AGENT_ID,
          taskSummary: 'Summarize' as NonEmpty,
          expectedOutputSlots: ['summary' as NonEmpty],
          inputSlotReads: [],
          taskPrompt: 'Summarize the doc' as NonEmpty,
        },
      ],
      subTaskEdges: [],
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]!.nodeType).toBe('nvg_dispatch');

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('pre_resolved_sub_tasks');
  });
});

// ─── Branch 3: preferred-agents preflight ───

describe('DbLexiconTransformerPlanner — Branch 3 preferred-agents preflight', () => {
  it('PASS path: warehouse-agent satisfies the required capabilities', async () => {
    const request = baseNormalRequest({
      selectedAgentIds: [WAREHOUSE_AGENT_ID],
      requiredCapabilities: [
        'read:record:single' as NonEmpty,
        'update:record:internal' as NonEmpty,
      ],
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(false);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('preflight_preferred_agents');
    expect(trace?.preflightOutcome).toBe('preferred_agents_satisfy');
    expect(trace?.planOutcome).toBe('plan_created');
    expect(planner.getLastRejectionCheckback()).toBeNull();
  });

  it('REJECT path: sales-agent missing update:record:internal — surfaces RejectionCheckbackPayload', async () => {
    const request = baseNormalRequest({
      selectedAgentIds: [SALES_AGENT_ID],
      requiredCapabilities: [
        'read:record:single' as NonEmpty,
        'update:record:internal' as NonEmpty,
      ],
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('no_capable_agent');
    expect(rejection.suggestedAlternatives.length).toBeGreaterThan(0);

    const checkback = planner.getLastRejectionCheckback();
    expect(checkback).not.toBeNull();
    expect(checkback?.missingCapabilities).toContain('update:record:internal');
    expect(checkback?.recommendedSelectedAgentIds).toContain(WAREHOUSE_AGENT_ID);
    expect(checkback?.alternativesByCapability['update:record:internal']?.length).toBeGreaterThan(
      0
    );

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('preflight_preferred_agents');
    expect(trace?.preflightOutcome).toBe('preferred_agents_insufficient_alternatives_suggested');
    expect(trace?.planOutcome).toBe('plan_rejected_no_capable_agent');
  });

  it('PASS-via-inference: empty requiredCapabilities + warehouse prompt → Layer C inferred → preflight passes', async () => {
    const request = baseNormalRequest({
      selectedAgentIds: [WAREHOUSE_AGENT_ID],
      requiredCapabilities: [],
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(false);
    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('preflight_preferred_agents');
    expect(trace?.preflightOutcome).toBe('preferred_agents_satisfy');
  });
});

// ─── Branch 4: lexical decomposition ───

describe('DbLexiconTransformerPlanner — Branch 4 lexical decomposition (warehouse worked example)', () => {
  it('emits a 3-node plan for the warehouse prompt', async () => {
    const request = baseNormalRequest({
      prompt: 'pull the warehouse inventory and adjust it +2 from receiving today' as NonEmpty,
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    expect(plan.nodes.length).toBe(3);

    // Verify the kinds: nxs read → nvg compute → nxs write
    const kindsByKey = new Map<string, string>();
    for (const node of plan.nodes) {
      kindsByKey.set(node.subTaskKey ?? '', node.nodeType);
    }
    expect(kindsByKey.get('read_inventory')).toBe('nxs_dispatch');
    expect(kindsByKey.get('compute_adjusted_units')).toBe('nvg_dispatch');
    expect(kindsByKey.get('write_inventory')).toBe('nxs_dispatch');

    // All three assigned to warehouse-agent
    for (const node of plan.nodes) {
      expect(node.agentId).toBe(WAREHOUSE_AGENT_ID);
    }

    // Verify 2 edges form the chain
    expect(plan.edges.length).toBe(2);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('lexical_decomposition');
    expect(trace?.selectedTemplate).toBe('workflow_inventory_adjust_from_receiving_v1');
    expect(trace?.planOutcome).toBe('plan_created');
    expect(trace?.promptDigest).not.toBeNull();
  });

  it('rejects on blocked alias — no plan produced', async () => {
    const request = baseNormalRequest({
      prompt: 'drop everything from the warehouse' as NonEmpty,
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(true);
    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('lexical_decomposition');
  });

  it('rejects with unmappable_request on unknown intent', async () => {
    const request = baseNormalRequest({
      prompt: 'frobnicate the quux widgets' as NonEmpty,
    });
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('unmappable_request');
  });
});

// ─── Branch dispatch + malformed ───

describe('DbLexiconTransformerPlanner — malformed requests', () => {
  it('metadata tier with no subTasks AND no selectedAgentIds → malformed_request', async () => {
    const request: MetadataPlannerRequest = {
      tier: 'metadata',
      runId: RUN_ID,
      userId: 'test-user' as NonEmpty,
      principalId: PRINCIPAL_ID,
      requiredCapabilities: [],
      requiredSystemTargets: [],
      selectedAgentIds: [],
      edgeHints: [],
      templateRef: null,
      taskShape: { subTaskCount: 0, expectedOutputTypes: [] },
      workspaceSocketId: 'workspace-ref' as NonEmpty,
      planCheckbackRequested: false,
      enteredAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
      preferredEndpointId: null,
      subTasks: null,
      subTaskEdges: null,
    };
    const result = await planner.plan(request, TEST_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('malformed_request');
  });
});

// ─── Trace + checkback stash discipline ───

// ─── Branch 0: chat tier (AMEND-nexus-planner-chat-tier-v0-2-0.md §9.1) ───

const CHAT_AGENT_ID = '00000000-0000-4000-8000-0000000000d1' as Uuid;
const CHAT_AGENT_2_ID = '00000000-0000-4000-8000-0000000000d2' as Uuid;

const CHAT_AGENT: AgentCapabilityEntry = {
  agentId: CHAT_AGENT_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['synthesize' as NonEmpty],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

const CHAT_AGENT_2: AgentCapabilityEntry = {
  agentId: CHAT_AGENT_2_ID,
  actorClass: 'SUPERVISED_AGENT' as NonEmpty,
  capabilities: ['synthesize' as NonEmpty],
  octTier: 'OCT-OPEN' as NonEmpty,
  environment: 'reference' as NonEmpty,
  enabled: true,
};

// Registry with chat-capable agents alongside the existing fixtures.
// Used for CHAT-01..10. CHAT-11 uses TEST_REGISTRY directly (which
// contains zero synthesize-capable agents).
const ALL_AGENTS_WITH_CHAT: AgentCapabilityEntry[] = [...ALL_AGENTS, CHAT_AGENT, CHAT_AGENT_2];
const CHAT_REGISTRY: AgentRegistryReader = {
  async findByCapability(capability: NonEmpty): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS_WITH_CHAT.filter(a => a.capabilities.includes(capability));
  },
  async getById(agentId: Uuid): Promise<AgentCapabilityEntry | null> {
    return ALL_AGENTS_WITH_CHAT.find(a => a.agentId === agentId) ?? null;
  },
  async listVisible(_ceiling: NonEmpty[]): Promise<AgentCapabilityEntry[]> {
    return ALL_AGENTS_WITH_CHAT;
  },
};

const CHAT_CONTEXT: PlannerContext = {
  registry: CHAT_REGISTRY,
  capabilityCeiling: [],
  maxSplitDepth: 3,
};

function baseChatRequest(overrides: Partial<ChatPlannerRequest> = {}): ChatPlannerRequest {
  return {
    tier: 'chat',
    runId: RUN_ID,
    userId: 'test-user' as NonEmpty,
    principalId: PRINCIPAL_ID,
    workspaceSocketId: 'nexus-chat-default' as NonEmpty,
    prompt: 'Who are you?' as NonEmpty,
    selectedAgentIds: [CHAT_AGENT_ID],
    preferredEndpointId: null,
    checkbackSourceRunId: null,
    enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    ...overrides,
  };
}

describe('DbLexiconTransformerPlanner — Branch 0 chat tier', () => {
  it('CHAT-01: happy path — agent with synthesize emits a single-node nvg_dispatch plan', async () => {
    const request = baseChatRequest();
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    expect(plan.nodes).toHaveLength(1);
    expect(plan.edges).toHaveLength(0);
    expect(plan.nodes[0]!.nodeType).toBe('nvg_dispatch');
    expect(plan.nodes[0]!.agentId).toBe(CHAT_AGENT_ID);
    expect(plan.nodes[0]!.taskPrompt).toBe('Who are you?');
    expect(plan.nodes[0]!.expectedOutputSlots).toEqual(['text']);

    const trace = planner.getLastTrace();
    expect(trace?.branch).toBe('chat');
    expect(trace?.preflightOutcome).toBe('preferred_agents_satisfy');
    expect(trace?.planOutcome).toBe('plan_created');
    expect(planner.getLastRejectionCheckback()).toBeNull();
  });

  it('CHAT-02: agent without synthesize → no_capable_agent with checkback payload', async () => {
    const request = baseChatRequest({
      selectedAgentIds: [SALES_AGENT_ID],
    });
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('no_capable_agent');

    const checkback = planner.getLastRejectionCheckback();
    expect(checkback).not.toBeNull();
    expect(checkback!.missingCapabilities).toEqual(['synthesize']);
    expect(checkback!.rejectedSelectedAgentIds).toEqual([SALES_AGENT_ID]);
    expect(checkback!.recommendedSelectedAgentIds.length).toBeGreaterThan(0);
  });

  it('CHAT-03: selectedAgentIds.length === 0 → malformed_request', async () => {
    const request = baseChatRequest({
      // Force empty array via cast — the tuple type would reject this at compile time
      selectedAgentIds: [] as unknown as readonly [Uuid],
    });
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('malformed_request');
    expect(rejection.reasonDetail).toContain('exactly one selectedAgentId');
    expect(planner.getLastRejectionCheckback()).toBeNull();
  });

  it('CHAT-04: selectedAgentIds.length === 2 → malformed_request', async () => {
    const request = baseChatRequest({
      // Force two agents via cast — the tuple type would reject this at compile time
      selectedAgentIds: [CHAT_AGENT_ID, CHAT_AGENT_2_ID] as unknown as readonly [Uuid],
    });
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('malformed_request');
    expect(rejection.reasonDetail).toContain('exactly one selectedAgentId');
  });

  it('CHAT-05: non-existent agentId → no_capable_agent (no checkback — UI staleness)', async () => {
    const GHOST_AGENT = '00000000-0000-4000-8000-00000000ffff' as Uuid;
    const request = baseChatRequest({
      selectedAgentIds: [GHOST_AGENT],
    });
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('no_capable_agent');
    expect(rejection.reasonDetail).toContain('not found in registry');
    expect(planner.getLastRejectionCheckback()).toBeNull();
  });

  it("CHAT-06: 'synthesize' not in capabilityCeiling → capability_outside_ceiling", async () => {
    const request = baseChatRequest();
    const ceilingContext: PlannerContext = {
      registry: CHAT_REGISTRY,
      capabilityCeiling: ['read:record:single' as NonEmpty],
      maxSplitDepth: 3,
    };
    const result = await planner.plan(request, ceilingContext);
    expect('rejected' in result).toBe(true);
    const rejection = result as PlanRejection;
    expect(rejection.reason).toBe('capability_outside_ceiling');
    expect(planner.getLastRejectionCheckback()).toBeNull();
  });

  it('CHAT-07: trace shape — lexicalMatches empty, candidateIntents empty, selectedTemplate null', async () => {
    const request = baseChatRequest();
    await planner.plan(request, CHAT_CONTEXT);
    const trace = planner.getLastTrace();
    expect(trace).not.toBeNull();
    expect(trace!.branch).toBe('chat');
    expect(trace!.lexicalMatches).toEqual([]);
    expect(trace!.candidateIntents).toEqual([]);
    expect(trace!.selectedIntent).toBeNull();
    expect(trace!.candidateTemplates).toEqual([]);
    expect(trace!.selectedTemplate).toBeNull();
    expect(trace!.requiredCapabilities).toEqual(['synthesize']);
    expect(trace!.candidateAgents).toEqual([
      { capability: 'synthesize', agentIds: [CHAT_AGENT_ID] },
    ]);
    expect(trace!.operatorPreference).toEqual({
      selectedAgentIds: [CHAT_AGENT_ID],
      preferredEndpointId: null,
    });
  });

  it('CHAT-08: dispatch order — chat tier hits Branch 0 even with foreign fields on the request', async () => {
    // Defensive — discriminate on tier === 'chat' before any other branch.
    // Cast lets us synthesize a malformed request shape that would otherwise
    // be caught at the type level.
    const malformed = {
      ...baseChatRequest(),
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'should-be-ignored' as NonEmpty,
          agentId: WAREHOUSE_AGENT_ID,
          taskSummary: 'should-be-ignored' as NonEmpty,
          expectedOutputSlots: ['x' as NonEmpty],
          inputSlotReads: [],
          taskPrompt: 'should-be-ignored' as NonEmpty,
        },
      ],
    } as unknown as ChatPlannerRequest;
    const result = await planner.plan(malformed, CHAT_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]!.agentId).toBe(CHAT_AGENT_ID);
    expect(planner.getLastTrace()?.branch).toBe('chat');
  });

  it('CHAT-09: buildChatPlan produces single-node plan with no edges and no output contract', async () => {
    const request = baseChatRequest();
    const result = await planner.plan(request, CHAT_CONTEXT);
    expect('rejected' in result).toBe(false);
    const plan = result as ExecutionPlan;
    // Pass-through compile semantics: single node + zero edges. No
    // outputContract field exists on ExecutionPlan (the compile path
    // detects pass-through from the absent compile template).
    expect(plan.nodes).toHaveLength(1);
    expect(plan.edges).toHaveLength(0);
    expect(plan.nodes[0]!.requiresNvg).toBe(true);
    expect(plan.nodes[0]!.requiresNxs).toBe(false);
  });

  it('CHAT-10: agent missing synthesize → checkback carries every synthesize-capable alternative', async () => {
    const request = baseChatRequest({
      selectedAgentIds: [SALES_AGENT_ID],
    });
    await planner.plan(request, CHAT_CONTEXT);
    const checkback = planner.getLastRejectionCheckback();
    expect(checkback).not.toBeNull();
    const alternatives = checkback!.alternativesByCapability['synthesize'];
    expect(alternatives).toBeDefined();
    expect(alternatives!.length).toBe(2);
    const altIds = alternatives!.map(a => a.agentId).sort();
    expect(altIds).toEqual([CHAT_AGENT_ID, CHAT_AGENT_2_ID].sort());
    // recommendedSelectedAgentIds is the first viable alternative
    expect(checkback!.recommendedSelectedAgentIds).toHaveLength(1);
    expect([CHAT_AGENT_ID, CHAT_AGENT_2_ID]).toContain(checkback!.recommendedSelectedAgentIds[0]);
  });

  it('CHAT-11: checkback recommendedSelectedAgentIds is [] when no synthesize-capable agent exists', async () => {
    // TEST_REGISTRY contains zero synthesize-capable agents — exactly
    // the registry shape that proves the empty-recommendations path.
    const request = baseChatRequest({
      selectedAgentIds: [SALES_AGENT_ID],
    });
    await planner.plan(request, TEST_CONTEXT);
    const checkback = planner.getLastRejectionCheckback();
    expect(checkback).not.toBeNull();
    expect(checkback!.recommendedSelectedAgentIds).toEqual([]);
    expect(checkback!.alternativesByCapability['synthesize']).toEqual([]);
    expect(checkback!.missingCapabilities).toEqual(['synthesize']);
    expect(checkback!.rejectedSelectedAgentIds).toEqual([SALES_AGENT_ID]);
  });
});

describe('DbLexiconTransformerPlanner — stash reset between plan() calls', () => {
  it('resets stash on each plan() invocation', async () => {
    // First call — preflight reject populates checkback
    const reject = baseNormalRequest({
      selectedAgentIds: [SALES_AGENT_ID],
      requiredCapabilities: ['update:record:internal' as NonEmpty],
    });
    await planner.plan(reject, TEST_CONTEXT);
    expect(planner.getLastRejectionCheckback()).not.toBeNull();

    // Second call — successful preflight should null out the previous checkback
    const pass = baseNormalRequest({
      selectedAgentIds: [WAREHOUSE_AGENT_ID],
      requiredCapabilities: ['read:record:single' as NonEmpty],
    });
    await planner.plan(pass, TEST_CONTEXT);
    expect(planner.getLastRejectionCheckback()).toBeNull();
    expect(planner.getLastTrace()?.preflightOutcome).toBe('preferred_agents_satisfy');
  });
});
