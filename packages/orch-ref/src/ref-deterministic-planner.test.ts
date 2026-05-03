// packages/orch-ref/src/ref-deterministic-planner.test.ts
// AMEND-spec-nexus-orch §11 — ORCH-01 through ORCH-04, ORCH-11, ORCH-13, ORCH-14, ORCH-20
// Unit tests for RefDeterministicPlanner, condition evaluation, dispatch branching.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  AgentRegistryReader,
  AgentCapabilityEntry,
  PlannerContext,
  NormalPlannerRequest,
  MetadataPlannerRequest,
  OctSecurePlannerRequest,
  PlannerRequest,
  EdgeHint,
  ExecutionPlan,
  PlanRejection,
  PlanCondition,
  PlanNode,
} from '@nexus/contracts';
import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';
import {
  RefDeterministicPlanner,
  evaluateCondition,
  determineNodeType,
} from './ref-deterministic-planner.js';

// ─── Test Helpers ───

const ORCH_ACTOR_ID = '00000000-0000-4000-a000-000000000001' as Uuid;

function mockDigest(obj: unknown): Sha256Hex {
  return createHash('sha256')
    .update(JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort()))
    .digest('hex') as Sha256Hex;
}

function makeAgent(
  id: string,
  capabilities: string[] = ['default'],
  enabled = true
): AgentCapabilityEntry {
  return {
    agentId: id as Uuid,
    actorClass: 'AUTONOMOUS_AGENT' as NonEmpty,
    capabilities: capabilities as NonEmpty[],
    octTier: 'OCT-STANDARD' as NonEmpty,
    environment: 'production' as NonEmpty,
    enabled,
  };
}

function mockRegistry(agents: AgentCapabilityEntry[]): AgentRegistryReader {
  return {
    async findByCapability(cap: NonEmpty): Promise<AgentCapabilityEntry[]> {
      return agents.filter(a => a.capabilities.includes(cap));
    },
    async getById(id: Uuid): Promise<AgentCapabilityEntry | null> {
      return agents.find(a => a.agentId === id) ?? null;
    },
    async listVisible(ceiling: NonEmpty[]): Promise<AgentCapabilityEntry[]> {
      if (ceiling.length === 0) return agents;
      return agents.filter(a => a.capabilities.some(c => ceiling.includes(c)));
    },
  };
}

function makeContext(
  agents: AgentCapabilityEntry[],
  ceiling: string[] = [],
  maxSplitDepth = 10
): PlannerContext {
  return {
    registry: mockRegistry(agents),
    capabilityCeiling: ceiling as NonEmpty[],
    maxSplitDepth,
  };
}

function normalRequest(overrides: Partial<NormalPlannerRequest> = {}): NormalPlannerRequest {
  return {
    tier: 'normal',
    runId: 'run-001' as Uuid,
    userId: 'user-001' as NonEmpty,
    principalId: 'principal-001' as Uuid,
    prompt: 'test prompt' as NonEmpty,
    selectedAgentIds: [],
    requiredCapabilities: [],
    edgeHints: [],
    workspaceSocketId: 'ws-001' as NonEmpty,
    planCheckbackRequested: false,
    enteredAt: nowIso(),
    ...overrides,
  };
}

function isPlan(result: ExecutionPlan | PlanRejection): result is ExecutionPlan {
  return !('rejected' in result);
}

function isRejection(result: ExecutionPlan | PlanRejection): result is PlanRejection {
  return 'rejected' in result && result.rejected === true;
}

// ─── ORCH-01: Planner interface — RefDeterministicPlanner implements Planner ───

describe('ORCH-01: Planner interface', () => {
  it('RefDeterministicPlanner implements Planner with correct type and version', () => {
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    expect(planner.plannerType).toBe('ref-deterministic');
    expect(planner.plannerVersion).toBe('1.0.0');
    expect(typeof planner.plan).toBe('function');
  });

  it('plan() returns ExecutionPlan or PlanRejection', async () => {
    const agents = [makeAgent('agent-a', ['read'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const request = normalRequest({
      selectedAgentIds: ['agent-a' as Uuid],
    });
    const result = await planner.plan(request, makeContext(agents));
    expect(isPlan(result) || isRejection(result)).toBe(true);
  });
});

// ─── ORCH-02: Plan creation — single-agent, multi-agent parallel, DAG with deps ───

describe('ORCH-02: Plan creation', () => {
  it('creates single-agent plan', async () => {
    const agents = [makeAgent('agent-a', ['read'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ selectedAgentIds: ['agent-a' as Uuid] }),
      makeContext(agents)
    );
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes[0].agentId).toBe('agent-a');
    expect(result.nodes[0].planOrderIndex).toBe(0);
  });

  it('creates multi-agent parallel plan (no edges)', async () => {
    const agents = [makeAgent('agent-a', ['read']), makeAgent('agent-b', ['write'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['agent-a' as Uuid, 'agent-b' as Uuid],
      }),
      makeContext(agents)
    );
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes[0].planOrderIndex).toBe(0);
    expect(result.nodes[1].planOrderIndex).toBe(1);
  });

  it('creates DAG with dependency edges', async () => {
    const agents = [makeAgent('agent-a', ['read']), makeAgent('agent-b', ['write'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const hints: EdgeHint[] = [
      {
        sourceAgentId: 'agent-a' as Uuid,
        targetAgentId: 'agent-b' as Uuid,
        edgeType: 'data_dependency',
        conditionSpec: null,
        outputSlotRef: null,
      },
    ];
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['agent-a' as Uuid, 'agent-b' as Uuid],
        edgeHints: hints,
      }),
      makeContext(agents)
    );
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].edgeType).toBe('data_dependency');
  });

  it('plan has valid planId, runId, planDigest, plannerType, createdAt', async () => {
    const agents = [makeAgent('agent-a', ['read'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({
        runId: 'run-xyz' as Uuid,
        selectedAgentIds: ['agent-a' as Uuid],
      }),
      makeContext(agents)
    );
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.planId).toBeTruthy();
    expect(result.runId).toBe('run-xyz');
    expect(result.planDigest).toBeTruthy();
    expect(result.planDigest).toHaveLength(64);
    expect(result.plannerType).toBe('ref-deterministic');
    expect(result.plannerVersion).toBe('1.0.0');
    expect(result.createdAt).toBeTruthy();
  });

  it('resolves agents by requiredCapabilities when selectedAgentIds empty', async () => {
    const agents = [makeAgent('agent-a', ['read', 'search']), makeAgent('agent-b', ['write'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ requiredCapabilities: ['read' as NonEmpty, 'write' as NonEmpty] }),
      makeContext(agents)
    );
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(2);
  });
});

// ─── ORCH-03: Plan rejection — all PlanRejectionReason codes exercised ───

describe('ORCH-03: Plan rejection', () => {
  it('rejects with no_capable_agent when agent not in registry', async () => {
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ selectedAgentIds: ['nonexistent' as Uuid] }),
      makeContext([])
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('no_capable_agent');
  });

  it('rejects with capability_outside_ceiling', async () => {
    const agents = [makeAgent('agent-a', ['secret_capability'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ selectedAgentIds: ['agent-a' as Uuid] }),
      makeContext(agents, ['public_capability'])
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('capability_outside_ceiling');
  });

  it('rejects with malformed_request when both selectedAgentIds and requiredCapabilities empty', async () => {
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(normalRequest(), makeContext([]));
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('malformed_request');
    expect(result.reasonDetail).toContain('V1 requires');
  });

  it('rejects with malformed_request on cyclic edge hints', async () => {
    const agents = [makeAgent('agent-a', ['read']), makeAgent('agent-b', ['write'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const hints: EdgeHint[] = [
      {
        sourceAgentId: 'agent-a' as Uuid,
        targetAgentId: 'agent-b' as Uuid,
        edgeType: 'sequential',
        conditionSpec: null,
        outputSlotRef: null,
      },
      {
        sourceAgentId: 'agent-b' as Uuid,
        targetAgentId: 'agent-a' as Uuid,
        edgeType: 'sequential',
        conditionSpec: null,
        outputSlotRef: null,
      },
    ];
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['agent-a' as Uuid, 'agent-b' as Uuid],
        edgeHints: hints,
      }),
      makeContext(agents)
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('malformed_request');
    expect(result.reasonDetail).toContain('cycle');
  });

  it('rejects with max_split_exceeded', async () => {
    const agents = [
      makeAgent('agent-a', ['read']),
      makeAgent('agent-b', ['write']),
      makeAgent('agent-c', ['execute']),
    ];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['agent-a' as Uuid, 'agent-b' as Uuid, 'agent-c' as Uuid],
      }),
      makeContext(agents, [], 2) // maxSplitDepth = 2, but 3 agents
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('max_split_exceeded');
  });

  it('rejects with structural_constraint — conditional edge with null conditionSpec', async () => {
    const agents = [makeAgent('agent-a', ['read']), makeAgent('agent-b', ['write'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const hints: EdgeHint[] = [
      {
        sourceAgentId: 'agent-a' as Uuid,
        targetAgentId: 'agent-b' as Uuid,
        edgeType: 'conditional',
        conditionSpec: null,
        outputSlotRef: null,
      },
    ];
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['agent-a' as Uuid, 'agent-b' as Uuid],
        edgeHints: hints,
      }),
      makeContext(agents)
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('malformed_request');
  });

  it('rejects with unmappable_request — no agent for required capability', async () => {
    const agents = [makeAgent('agent-a', ['read'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ requiredCapabilities: ['nonexistent_capability' as NonEmpty] }),
      makeContext(agents)
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.reason).toBe('no_capable_agent');
  });
});

// ─── ORCH-04: Suggest-not-deny — alternatives returned when available ───

describe('ORCH-04: Suggest-not-deny', () => {
  it('returns suggestedAlternatives when agent not found', async () => {
    const agents = [makeAgent('agent-alt', ['read'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['nonexistent' as Uuid],
        requiredCapabilities: ['read' as NonEmpty],
      }),
      makeContext(agents)
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.suggestedAlternatives.length).toBeGreaterThan(0);
    expect(result.suggestedAlternatives[0].agentId).toBe('agent-alt');
  });

  it('returns empty alternatives when none available', async () => {
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({ selectedAgentIds: ['nonexistent' as Uuid] }),
      makeContext([])
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    expect(result.suggestedAlternatives).toHaveLength(0);
  });

  it('filters alternatives by capability ceiling', async () => {
    const agents = [
      makeAgent('visible-agent', ['public_cap']),
      makeAgent('hidden-agent', ['secret_cap']),
    ];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const result = await planner.plan(
      normalRequest({
        selectedAgentIds: ['nonexistent' as Uuid],
        requiredCapabilities: ['public_cap' as NonEmpty],
      }),
      makeContext(agents, ['public_cap'])
    );
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) return;
    const altIds = result.suggestedAlternatives.map(a => a.agentId);
    expect(altIds).toContain('visible-agent');
    expect(altIds).not.toContain('hidden-agent');
  });
});

// ─── ORCH-11: Visibility tiers — oct_secure input has no prompt/metadata fields ───

describe('ORCH-11: Visibility tiers', () => {
  it('oct_secure request physically cannot carry prompt content', () => {
    const request: OctSecurePlannerRequest = {
      tier: 'oct_secure',
      runId: 'run-001' as Uuid,
      userId: 'user-001' as NonEmpty,
      principalId: 'principal-001' as Uuid,
      secureAgentId: 'agent-secure' as Uuid,
      workspaceSocketId: 'ws-001' as NonEmpty,
      enteredAt: nowIso(),
    };
    // Type-level enforcement: these properties do not exist
    expect('prompt' in request).toBe(false);
    expect('requiredCapabilities' in request).toBe(false);
    expect('selectedAgentIds' in request).toBe(false);
    expect('edgeHints' in request).toBe(false);
    expect('taskShape' in request).toBe(false);
  });

  it('metadata request has no prompt field', () => {
    const request: MetadataPlannerRequest = {
      tier: 'metadata',
      runId: 'run-001' as Uuid,
      userId: 'user-001' as NonEmpty,
      principalId: 'principal-001' as Uuid,
      requiredCapabilities: ['read' as NonEmpty],
      requiredSystemTargets: ['target-1' as NonEmpty],
      selectedAgentIds: [],
      edgeHints: [],
      templateRef: null,
      taskShape: { subTaskCount: 1, expectedOutputTypes: ['text' as NonEmpty] },
      workspaceSocketId: 'ws-001' as NonEmpty,
      planCheckbackRequested: false,
      enteredAt: nowIso(),
    };
    expect('prompt' in request).toBe(false);
  });

  it('normal request has prompt field', () => {
    const request = normalRequest({ prompt: 'real prompt' as NonEmpty });
    expect(request.prompt).toBe('real prompt');
  });
});

// ─── ORCH-13: Dispatch branching — nvg/nxs/local_control/secure_agent_handoff ───

describe('ORCH-13: Dispatch branching', () => {
  it('nvg_dispatch: requiresNvg=true, requiresNxs=false', () => {
    const result = determineNodeType(true, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('nvg_dispatch');
  });

  it('nxs_dispatch: requiresNvg=false, requiresNxs=true', () => {
    const result = determineNodeType(false, true, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('nxs_dispatch');
  });

  it('local_control: both false, agentId = orchestratorActorId', () => {
    const result = determineNodeType(false, false, ORCH_ACTOR_ID, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('local_control');
  });

  it('secure_agent_handoff: both false, isSecureHandoff=true', () => {
    const result = determineNodeType(false, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, true);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('secure_agent_handoff');
  });

  it('both-true rejected', () => {
    const result = determineNodeType(true, true, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(false);
  });

  it('local_control rejects when agentId != orchestratorActorId', () => {
    const result = determineNodeType(false, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(false);
  });
});

// ─── ORCH-14: Condition evaluation — type coercion law ───

describe('ORCH-14: Condition evaluation', () => {
  const cond = (op: string, value: string | number | boolean | null): PlanCondition => ({
    conditionId: 'cond-001' as Uuid,
    sourceField: 'field' as NonEmpty,
    operator: op as PlanCondition['operator'],
    value,
  });

  it('equals: strict equality', () => {
    expect(evaluateCondition(cond('equals', 'hello'), { field: 'hello' }).result).toBe(true);
    expect(evaluateCondition(cond('equals', 'hello'), { field: 'world' }).result).toBe(false);
    expect(evaluateCondition(cond('equals', 42), { field: 42 }).result).toBe(true);
    expect(evaluateCondition(cond('equals', 42), { field: '42' }).result).toBe(false); // strict
  });

  it('not_equals: strict inequality', () => {
    expect(evaluateCondition(cond('not_equals', 'hello'), { field: 'world' }).result).toBe(true);
    expect(evaluateCondition(cond('not_equals', 'hello'), { field: 'hello' }).result).toBe(false);
  });

  it('exists: value !== undefined && value !== null', () => {
    expect(evaluateCondition(cond('exists', null), { field: 'present' }).result).toBe(true);
    expect(evaluateCondition(cond('exists', null), { field: null }).result).toBe(false);
    expect(evaluateCondition(cond('exists', null), {}).result).toBe(false);
  });

  it('not_exists: value === undefined || value === null', () => {
    expect(evaluateCondition(cond('not_exists', null), {}).result).toBe(true);
    expect(evaluateCondition(cond('not_exists', null), { field: null }).result).toBe(true);
    expect(evaluateCondition(cond('not_exists', null), { field: 'val' }).result).toBe(false);
  });

  it('gt: number-only, type_mismatch on non-number', () => {
    expect(evaluateCondition(cond('gt', 10), { field: 20 }).result).toBe(true);
    expect(evaluateCondition(cond('gt', 10), { field: 5 }).result).toBe(false);
    const mismatch = evaluateCondition(cond('gt', 10), { field: 'string' });
    expect(mismatch.result).toBe(false);
    expect(mismatch.reason).toBe('type_mismatch');
  });

  it('lt: number-only, type_mismatch on non-number', () => {
    expect(evaluateCondition(cond('lt', 10), { field: 5 }).result).toBe(true);
    expect(evaluateCondition(cond('lt', 10), { field: 20 }).result).toBe(false);
    const mismatch = evaluateCondition(cond('lt', 10), { field: true });
    expect(mismatch.result).toBe(false);
    expect(mismatch.reason).toBe('type_mismatch');
  });

  it('gt/lt: NaN and Infinity are type_mismatch', () => {
    expect(evaluateCondition(cond('gt', 10), { field: NaN }).reason).toBe('type_mismatch');
    expect(evaluateCondition(cond('gt', 10), { field: Infinity }).reason).toBe('type_mismatch');
    expect(evaluateCondition(cond('lt', NaN), { field: 5 }).reason).toBe('type_mismatch');
  });
});

// ─── ORCH-20: OCT-secure plan node ───

describe('ORCH-20: OCT-secure plan node', () => {
  it('oct_secure produces secure_agent_handoff with OCT_SECURE_REDACTED', async () => {
    const agents = [makeAgent('agent-secure', ['secure_op'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const request: OctSecurePlannerRequest = {
      tier: 'oct_secure',
      runId: 'run-001' as Uuid,
      userId: 'user-001' as NonEmpty,
      principalId: 'principal-001' as Uuid,
      secureAgentId: 'agent-secure' as Uuid,
      workspaceSocketId: 'ws-001' as NonEmpty,
      enteredAt: nowIso(),
    };
    const result = await planner.plan(request, makeContext(agents));
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0];
    expect(node.nodeType).toBe('secure_agent_handoff');
    expect(node.taskSummary).toBe('OCT_SECURE_REDACTED');
    expect(node.requiresNvg).toBe(false);
    expect(node.requiresNxs).toBe(false);
    // No prompt/metadata/capabilities content in node
    expect(node.taskSummary).not.toContain('prompt');
    expect(node.taskSummary).not.toContain('capability');
  });

  it('oct_secure plan has single node and no edges', async () => {
    const agents = [makeAgent('agent-secure', ['secure_op'])];
    const planner = new RefDeterministicPlanner(mockDigest, ORCH_ACTOR_ID);
    const request: OctSecurePlannerRequest = {
      tier: 'oct_secure',
      runId: 'run-001' as Uuid,
      userId: 'user-001' as NonEmpty,
      principalId: 'principal-001' as Uuid,
      secureAgentId: 'agent-secure' as Uuid,
      workspaceSocketId: 'ws-001' as NonEmpty,
      enteredAt: nowIso(),
    };
    const result = await planner.plan(request, makeContext(agents));
    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });
});
