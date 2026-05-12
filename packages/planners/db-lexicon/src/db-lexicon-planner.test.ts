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
