// packages/orch-ref/src/coordinator-amendment.test.ts
// AMEND-spec-nexus-orch §7.2.1, §8 — Coordinator + Amendment Tests
// Gates: ORCH-09, ORCH-10, ORCH-21, ORCH-24

import { describe, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  PlanNode,
  PlanEdge,
  PlanCondition,
  ExecutionPlan,
  RunDagState,
  NodeDelegationBinding,
  OrchestratorManifestRecord,
  WorkspaceRunRequest,
} from '@nexus/contracts';

import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

import { validateExecutionPlan } from './validate-plan.js';
import type { PlanValidationResult } from './validate-plan.js';
import { PlanAmendmentHandler, validateMerge, mergePlans } from './plan-amendment.js';
import type { AmendmentDeps } from './plan-amendment.js';
import type { DelegationScope } from './run-coordinator.js';

// ─── Helpers ───

function uuid(): Uuid {
  return randomUUID() as Uuid;
}

function computeDigest(obj: unknown): Sha256Hex {
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json).digest('hex') as Sha256Hex;
}

const orchestratorActorId = uuid();

function makeNode(overrides: Partial<PlanNode> & { planOrderIndex: number }): PlanNode {
  return {
    nodeId: overrides.nodeId ?? uuid(),
    planOrderIndex: overrides.planOrderIndex,
    agentId: overrides.agentId ?? uuid(),
    taskSummary: (overrides.taskSummary ?? 'test-task') as NonEmpty,
    requiresNvg: overrides.requiresNvg ?? false,
    requiresNxs: overrides.requiresNxs ?? true,
    nodeType: overrides.nodeType ?? 'nxs_dispatch',
    declaredRiskHint: EVIDENCE_SENTINEL,
    expectedOutputSlots: ['default' as NonEmpty],
    timeoutMs: overrides.timeoutMs ?? 30000,
    ...overrides,
  };
}

function makeEdge(
  sourceNodeId: Uuid,
  targetNodeId: Uuid,
  edgeType: PlanEdge['edgeType'] = 'data_dependency',
  condition: PlanCondition | null = null
): PlanEdge {
  return {
    edgeId: uuid(),
    sourceNodeId,
    targetNodeId,
    edgeType,
    condition,
    outputSlotRef: null,
  };
}

function makePlan(nodes: PlanNode[], edges: PlanEdge[] = [], runId?: Uuid): ExecutionPlan {
  const plan: Omit<ExecutionPlan, 'planDigest'> = {
    planId: uuid(),
    runId: runId ?? uuid(),
    nodes: [...nodes].sort((a, b) => a.planOrderIndex - b.planOrderIndex),
    edges: [...edges].sort(compareEdges),
    plannerType: 'ref-deterministic' as NonEmpty,
    plannerVersion: '1.0.0' as NonEmpty,
    createdAt: nowIso(),
  };

  const planDigest = computeDigest({
    planId: plan.planId,
    runId: plan.runId,
    nodes: plan.nodes,
    edges: plan.edges,
    plannerType: plan.plannerType,
    plannerVersion: plan.plannerVersion,
  });

  return { ...plan, planDigest };
}

function compareEdges(a: PlanEdge, b: PlanEdge): number {
  if (a.sourceNodeId < b.sourceNodeId) return -1;
  if (a.sourceNodeId > b.sourceNodeId) return 1;
  if (a.targetNodeId < b.targetNodeId) return -1;
  if (a.targetNodeId > b.targetNodeId) return 1;
  if (a.edgeType < b.edgeType) return -1;
  if (a.edgeType > b.edgeType) return 1;
  if (a.edgeId < b.edgeId) return -1;
  if (a.edgeId > b.edgeId) return 1;
  return 0;
}

function makeManifest(
  overrides: Partial<OrchestratorManifestRecord> = {}
): OrchestratorManifestRecord {
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
    planAmendment: {
      enabled: true,
      maxAmendments: 3,
      requiresCheckback: false,
    },
    partialCompletion: {
      enabled: true,
      minRequiredCompletedNodes: 1,
      compileOnPartial: true,
    },
    ...overrides,
  } as OrchestratorManifestRecord;
}

function makeRequest(runId?: Uuid): WorkspaceRunRequest {
  const rid = runId ?? uuid();
  return {
    runId: rid,
    userId: 'user-1' as NonEmpty,
    principalId: uuid(),
    authenticatedBy: 'ref-identity' as NonEmpty,
    enteredAt: nowIso(),
    prompt: 'test request' as NonEmpty,
    promptDigest: 'abc123' as Sha256Hex,
    promptRef: null,
    selectedAgentIds: [],
    workspaceSocketId: 'ref-workspace-v1' as NonEmpty,
    planCheckbackRequested: false,
  };
}

function makeState(
  plan: ExecutionPlan,
  delegations?: NodeDelegationBinding[],
  amendmentCount?: number
): RunDagState {
  return {
    plan,
    nodeStatuses: plan.nodes.map(n => ({
      nodeId: n.nodeId,
      planOrderIndex: n.planOrderIndex,
      status: 'pending' as const,
      runSequence: 0,
      completionMetadata: null,
      failureReason: null,
      governanceDenied: false,
    })),
    nodeDelegations:
      delegations ??
      plan.nodes
        .filter(n => n.nodeType !== 'local_control')
        .map(n => ({
          nodeId: n.nodeId,
          agentId: n.agentId,
          delegationId: uuid(),
        })),
    runSequenceCounter: 0,
    amendmentCount: amendmentCount ?? 0,
    cancelled: false,
  };
}

function makeAmendmentDeps(overrides: Partial<AmendmentDeps> = {}): AmendmentDeps {
  return {
    computeDigest: overrides.computeDigest ?? computeDigest,
    issueDelegation: overrides.issueDelegation ?? vi.fn(async () => uuid()),
    writeLedgerEvent: overrides.writeLedgerEvent ?? vi.fn(async () => {}),
    sendPlanCheckback: overrides.sendPlanCheckback ?? vi.fn(async () => true),
  };
}

// ─── ORCH-24: validateExecutionPlan — all 14 checks ───

describe('ORCH-24: validateExecutionPlan', () => {
  it('check 1: rejects plan.runId !== request.runId', () => {
    const node = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([node]);
    const request = makeRequest(); // different runId
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 1');
  });

  it('check 2: rejects tampered planDigest', () => {
    const node = makeNode({ planOrderIndex: 0 });
    const runId = uuid();
    const plan = makePlan([node], [], runId);
    plan.planDigest = 'tampered' as Sha256Hex;
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 2');
  });

  it('check 3: rejects unsorted nodes', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 1 });
    const nodeB = makeNode({ planOrderIndex: 0 });
    // Deliberately unsorted
    const plan = makePlan([nodeA, nodeB], [], runId);
    // Manually break sort
    plan.nodes = [nodeA, nodeB]; // index 1 before 0
    // Recompute digest with broken sort to pass check 2
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: [...plan.nodes].sort((a, b) => a.planOrderIndex - b.planOrderIndex),
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 3');
  });

  it('check 4: rejects non-contiguous planOrderIndex', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 2 }); // gap: no index 1
    const plan = makePlan([nodeA, nodeB], [], runId);
    // Recompute digest
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 4');
  });

  it('check 5: rejects duplicate nodeId', () => {
    const runId = uuid();
    const sharedId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0, nodeId: sharedId });
    const nodeB = makeNode({ planOrderIndex: 1, nodeId: sharedId });
    const plan = makePlan([nodeA, nodeB], [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 5');
  });

  it('check 6: rejects duplicate edgeId', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const nodeC = makeNode({ planOrderIndex: 2 });
    const sharedEdgeId = uuid();
    const edgeAB = makeEdge(nodeA.nodeId, nodeB.nodeId);
    edgeAB.edgeId = sharedEdgeId;
    const edgeAC = makeEdge(nodeA.nodeId, nodeC.nodeId);
    edgeAC.edgeId = sharedEdgeId;
    const edges = [edgeAB, edgeAC].sort(compareEdges);
    const plan = makePlan([nodeA, nodeB, nodeC], edges, runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 6');
  });

  it('check 7: rejects edge referencing non-existent node', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const fakeNodeId = uuid();
    const edge = makeEdge(nodeA.nodeId, fakeNodeId);
    const plan = makePlan([nodeA], [edge], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 7');
  });

  it('check 8: rejects cyclic graph', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edgeAB = makeEdge(nodeA.nodeId, nodeB.nodeId);
    const edgeBA = makeEdge(nodeB.nodeId, nodeA.nodeId);
    const edges = [edgeAB, edgeBA].sort(compareEdges);
    const plan = makePlan([nodeA, nodeB], edges, runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 8');
  });

  it('check 10: rejects both requiresNvg and requiresNxs true', () => {
    const runId = uuid();
    const node = makeNode({
      planOrderIndex: 0,
      requiresNvg: true,
      requiresNxs: true,
      nodeType: 'nxs_dispatch',
    });
    const plan = makePlan([node], [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 10');
  });

  it('check 11: rejects nodeType mismatch with requiresNvg/requiresNxs', () => {
    const runId = uuid();
    const node = makeNode({
      planOrderIndex: 0,
      requiresNvg: true,
      requiresNxs: false,
      nodeType: 'nxs_dispatch', // wrong — should be nvg_dispatch
    });
    const plan = makePlan([node], [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 11');
  });

  it('check 12: rejects local_control with wrong agentId', () => {
    const runId = uuid();
    const node = makeNode({
      planOrderIndex: 0,
      nodeType: 'local_control',
      agentId: uuid(), // NOT orchestratorActorId
      requiresNvg: false,
      requiresNxs: false,
    });
    const plan = makePlan([node], [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 12');
  });

  it('check 13: rejects secure_agent_handoff without OCT_SECURE_REDACTED', () => {
    const runId = uuid();
    const node = makeNode({
      planOrderIndex: 0,
      nodeType: 'secure_agent_handoff',
      taskSummary: 'wrong-summary' as NonEmpty,
      requiresNvg: false,
      requiresNxs: false,
    });
    const plan = makePlan([node], [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 13');
  });

  it('check 14: rejects plan exceeding maxSplitDepth', () => {
    const runId = uuid();
    const nodes = Array.from({ length: 3 }, (_, i) => makeNode({ planOrderIndex: i }));
    const plan = makePlan(nodes, [], runId);
    plan.planDigest = computeDigest({
      planId: plan.planId,
      runId: plan.runId,
      nodes: plan.nodes,
      edges: plan.edges,
      plannerType: plan.plannerType,
      plannerVersion: plan.plannerVersion,
    });
    const request = makeRequest(runId);
    const manifest = makeManifest({ maxSplitDepth: 2 });

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('Check 14');
  });

  it('accepts valid plan — all 14 checks pass', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId);
    const plan = makePlan([nodeA, nodeB], [edge], runId);
    const request = makeRequest(runId);
    const manifest = makeManifest();

    const result = validateExecutionPlan(
      plan,
      request,
      manifest,
      computeDigest,
      orchestratorActorId
    );
    expect(result.failed).toBe(false);
    expect(result.reason).toBeNull();
  });
});

// ─── ORCH-10: maxAmendments enforced ───

describe('ORCH-10: Plan amendment — maxAmendments enforced', () => {
  it('rejects amendment when amendmentCount >= maxAmendments', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan, undefined, 3); // already at max
    const manifest = makeManifest({
      planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
    });

    const extensionNode = makeNode({ planOrderIndex: 0 });
    const extension = makePlan([extensionNode], [], runId);

    const deps = makeAmendmentDeps();
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('max_amendments_exceeded');
    expect(deps.writeLedgerEvent).toHaveBeenCalledWith(
      'plan_amended',
      expect.objectContaining({ approved: false, reason: 'max_amendments_exceeded' })
    );
  });

  it('allows amendment when under maxAmendments', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan, undefined, 0);
    const manifest = makeManifest();

    const extensionNode = makeNode({ planOrderIndex: 0 });
    const extension = makePlan([extensionNode], [], runId);

    const deps = makeAmendmentDeps();
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(true);
    expect(state.amendmentCount).toBe(1);
  });
});

// ─── ORCH-09: scope expansion triggers governance re-check ───

describe('ORCH-09: Plan amendment — scope expansion triggers re-check', () => {
  it('triggers checkback when new agent not in original plan', async () => {
    const runId = uuid();
    const existingAgent = uuid();
    const nodeA = makeNode({ planOrderIndex: 0, agentId: existingAgent });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest({
      planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: true },
    });

    const newAgent = uuid(); // different from existingAgent
    const extensionNode = makeNode({ planOrderIndex: 0, agentId: newAgent });
    const extension = makePlan([extensionNode], [], runId);

    const sendCheckback = vi.fn(async () => true);
    const deps = makeAmendmentDeps({ sendPlanCheckback: sendCheckback });
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(sendCheckback).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('rejects when checkback returns false', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest({
      planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: true },
    });

    const extensionNode = makeNode({ planOrderIndex: 0, agentId: uuid() });
    const extension = makePlan([extensionNode], [], runId);

    const deps = makeAmendmentDeps({
      sendPlanCheckback: vi.fn(async () => false),
    });
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('checkback_rejected');
  });

  it('skips checkback when requiresCheckback=false even with new agent', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest({
      planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
    });

    const extensionNode = makeNode({ planOrderIndex: 0, agentId: uuid() });
    const extension = makePlan([extensionNode], [], runId);

    const sendCheckback = vi.fn(async () => true);
    const deps = makeAmendmentDeps({ sendPlanCheckback: sendCheckback });
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(sendCheckback).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

// ─── ORCH-21: Plan amendment merge ───

describe('ORCH-21: Plan amendment merge', () => {
  it('rebases planOrderIndex from max(existing) + 1', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const plan = makePlan([nodeA, nodeB], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest();

    const extNode = makeNode({ planOrderIndex: 0 }); // will be rebased to 2
    const extension = makePlan([extNode], [], runId);

    const deps = makeAmendmentDeps();
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(true);
    const mergedNodes = result.mergedPlan!.nodes;
    expect(mergedNodes).toHaveLength(3);
    expect(mergedNodes[2].planOrderIndex).toBe(2);
    expect(mergedNodes[2].nodeId).toBe(extNode.nodeId);
  });

  it('rejects on nodeId collision', () => {
    const runId = uuid();
    const sharedNodeId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0, nodeId: sharedNodeId });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);

    const extNode = makeNode({ planOrderIndex: 0, nodeId: sharedNodeId });
    const extension = makePlan([extNode], [], runId);

    const result = validateMerge(plan, extension, state);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('nodeId collision');
  });

  it('rejects on edgeId collision', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const sharedEdgeId = uuid();
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId);
    edge.edgeId = sharedEdgeId;
    const plan = makePlan([nodeA, nodeB], [edge], runId);
    const state = makeState(plan);

    const extNodeC = makeNode({ planOrderIndex: 0 });
    const extEdge = makeEdge(nodeA.nodeId, extNodeC.nodeId);
    extEdge.edgeId = sharedEdgeId;
    const extension = makePlan([extNodeC], [extEdge], runId);

    const result = validateMerge(plan, extension, state);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('edgeId collision');
  });

  it('rejects when merge creates cycle', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edgeAB = makeEdge(nodeA.nodeId, nodeB.nodeId);
    const plan = makePlan([nodeA, nodeB], [edgeAB], runId);
    const state = makeState(plan);

    // Extension adds edge B→A creating cycle
    const edgeBA = makeEdge(nodeB.nodeId, nodeA.nodeId);
    const extension: ExecutionPlan = {
      planId: uuid(),
      runId,
      planDigest: '' as Sha256Hex,
      nodes: [],
      edges: [edgeBA],
      plannerType: 'ref-deterministic' as NonEmpty,
      plannerVersion: '1.0.0' as NonEmpty,
      createdAt: nowIso(),
    };

    const result = validateMerge(plan, extension, state);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('cycle');
  });

  it('recomputes planDigest after merge', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const originalDigest = plan.planDigest;
    const state = makeState(plan);
    const manifest = makeManifest();

    const extNode = makeNode({ planOrderIndex: 0 });
    const extension = makePlan([extNode], [], runId);

    const deps = makeAmendmentDeps();
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(true);
    expect(result.mergedPlan!.planDigest).not.toBe(originalDigest);
    // Verify digest is correctly computed
    const expectedDigest = computeDigest({
      planId: result.mergedPlan!.planId,
      runId: result.mergedPlan!.runId,
      nodes: result.mergedPlan!.nodes,
      edges: result.mergedPlan!.edges,
      plannerType: result.mergedPlan!.plannerType,
      plannerVersion: result.mergedPlan!.plannerVersion,
    });
    expect(result.mergedPlan!.planDigest).toBe(expectedDigest);
  });

  it('inserts NodeDelegationBindings for new dispatchable nodes', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest();

    const extNode = makeNode({ planOrderIndex: 0, nodeType: 'nxs_dispatch' });
    const extension = makePlan([extNode], [], runId);

    const issueDelegation = vi.fn(async () => uuid());
    const deps = makeAmendmentDeps({ issueDelegation });
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(true);
    expect(result.newDelegationBindings).toHaveLength(1);
    expect(result.newDelegationBindings[0].nodeId).toBe(extNode.nodeId);
    expect(issueDelegation).toHaveBeenCalledTimes(1);
    // Verify binding was added to state
    expect(state.nodeDelegations.some(b => b.nodeId === extNode.nodeId)).toBe(true);
  });

  it('does not issue delegation for local_control extension nodes', async () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    const manifest = makeManifest();

    const extNode = makeNode({
      planOrderIndex: 0,
      nodeType: 'local_control',
      agentId: orchestratorActorId,
      requiresNvg: false,
      requiresNxs: false,
    });
    const extension = makePlan([extNode], [], runId);

    const issueDelegation = vi.fn(async () => uuid());
    const deps = makeAmendmentDeps({ issueDelegation });
    const handler = new PlanAmendmentHandler(manifest, deps);
    const result = await handler.handleAmendment(state, extension);

    expect(result.success).toBe(true);
    expect(issueDelegation).not.toHaveBeenCalled();
    expect(result.newDelegationBindings).toHaveLength(0);
  });

  it('rejects when extension targets terminal node', () => {
    const runId = uuid();
    const nodeA = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([nodeA], [], runId);
    const state = makeState(plan);
    // Mark nodeA as completed
    state.nodeStatuses[0].status = 'completed';

    const extNode = makeNode({ planOrderIndex: 0 });
    // Edge from extension targeting completed nodeA
    const edge = makeEdge(extNode.nodeId, nodeA.nodeId);
    const extension: ExecutionPlan = {
      planId: uuid(),
      runId,
      planDigest: '' as Sha256Hex,
      nodes: [extNode],
      edges: [edge],
      plannerType: 'ref-deterministic' as NonEmpty,
      plannerVersion: '1.0.0' as NonEmpty,
      createdAt: nowIso(),
    };

    const result = validateMerge(plan, extension, state);
    expect(result.failed).toBe(true);
    expect(result.reason).toContain('terminal node');
  });
});
