// packages/orch-ref/src/dag-executor.test.ts
// AMEND-spec-nexus-orch §6 — DAG Executor Tests
// Gates: ORCH-05, ORCH-06, ORCH-07, ORCH-08, ORCH-12, ORCH-22

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type {
  Uuid,
  NonEmpty,
  PlanNode,
  PlanEdge,
  PlanCondition,
  NodeStatus,
  RunDagState,
  ExecutionPlan,
  NodeDelegationBinding,
} from '@nexus/contracts';

import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

import { RefDagExecutor, classifyDagCompletion } from './dag-executor.js';

import type {
  DagExecutorDeps,
  NodeDispatchResult,
  PartialCompletionConfig,
} from './dag-executor.js';

import { evaluateCondition } from './condition-evaluator.js';

// ─── Test Helpers ───

function uuid(): Uuid {
  return randomUUID() as Uuid;
}

function makeNode(overrides: Partial<PlanNode> & { planOrderIndex: number }): PlanNode {
  return {
    nodeId: uuid(),
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

function makePlan(nodes: PlanNode[], edges: PlanEdge[] = []): ExecutionPlan {
  return {
    planId: uuid(),
    runId: uuid(),
    planDigest: 'deadbeef'.repeat(8) as `${string}`,
    nodes,
    edges,
    plannerType: 'ref-deterministic' as NonEmpty,
    plannerVersion: '1.0.0' as NonEmpty,
    createdAt: nowIso(),
  };
}

function makeState(plan: ExecutionPlan, delegations?: NodeDelegationBinding[]): RunDagState {
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
    amendmentCount: 0,
    cancelled: false,
  };
}

function makeDeps(overrides: Partial<DagExecutorDeps> = {}): DagExecutorDeps {
  return {
    dispatchNode:
      overrides.dispatchNode ??
      vi.fn(
        async (): Promise<NodeDispatchResult> => ({
          success: true,
          completionMetadata: {},
          failureReason: null,
          governanceDenied: false,
        })
      ),
    resolveCondition:
      overrides.resolveCondition ??
      ((condition: PlanCondition, metadata: Record<string, unknown>) =>
        evaluateCondition(condition, metadata).result),
    onNodeEvent: overrides.onNodeEvent ?? vi.fn(async () => {}),
  };
}

const defaultPartial: PartialCompletionConfig = {
  enabled: false,
  minRequiredCompletedNodes: 0,
};

// ─── ORCH-05: DAG executor — parallel dispatch, dependency resolution, conditionals ───

describe('ORCH-05: DAG executor', () => {
  it('dispatches single root node and completes', async () => {
    const node = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([node]);
    const state = makeState(plan);
    const deps = makeDeps();
    const executor = new RefDagExecutor(defaultPartial);

    const result = await executor.execute(state, deps);

    expect(result.completedNodes).toHaveLength(1);
    expect(result.completedNodes[0]).toBe(node.nodeId);
    expect(result.failedNodes).toHaveLength(0);
    expect(result.skippedNodes).toHaveLength(0);
  });

  it('dispatches parallel root nodes concurrently', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const plan = makePlan([nodeA, nodeB]);
    const state = makeState(plan);

    const dispatched: Uuid[] = [];
    const deps = makeDeps({
      dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
        dispatched.push(node.nodeId);
        return {
          success: true,
          completionMetadata: { agent: node.agentId },
          failureReason: null,
          governanceDenied: false,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(dispatched).toContain(nodeA.nodeId);
    expect(dispatched).toContain(nodeB.nodeId);
    expect(result.completedNodes).toHaveLength(2);
  });

  it('resolves data_dependency: B dispatches only after A completes', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'data_dependency');
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const dispatchOrder: number[] = [];
    const deps = makeDeps({
      dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
        dispatchOrder.push(node.planOrderIndex);
        return {
          success: true,
          completionMetadata: {},
          failureReason: null,
          governanceDenied: false,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    // A dispatched before B
    expect(dispatchOrder).toEqual([0, 1]);
    expect(result.completedNodes).toHaveLength(2);
  });

  it('resolves sequential dependency', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'sequential');
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const dispatchOrder: number[] = [];
    const deps = makeDeps({
      dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
        dispatchOrder.push(node.planOrderIndex);
        return {
          success: true,
          completionMetadata: {},
          failureReason: null,
          governanceDenied: false,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    await executor.execute(state, deps);

    expect(dispatchOrder).toEqual([0, 1]);
  });

  it('evaluates conditional edge — true → target ready', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const condition: PlanCondition = {
      conditionId: uuid(),
      sourceField: 'status' as NonEmpty,
      operator: 'equals',
      value: 'ok',
    };
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'conditional', condition);
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(
        async (node: PlanNode): Promise<NodeDispatchResult> => ({
          success: true,
          completionMetadata: node.planOrderIndex === 0 ? { status: 'ok' } : {},
          failureReason: null,
          governanceDenied: false,
        })
      ),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.completedNodes).toHaveLength(2);
    expect(result.skippedNodes).toHaveLength(0);
  });

  it('evaluates conditional edge — false → target skipped', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const condition: PlanCondition = {
      conditionId: uuid(),
      sourceField: 'status' as NonEmpty,
      operator: 'equals',
      value: 'ok',
    };
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'conditional', condition);
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(
        async (): Promise<NodeDispatchResult> => ({
          success: true,
          completionMetadata: { status: 'error' }, // condition fails
          failureReason: null,
          governanceDenied: false,
        })
      ),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.completedNodes).toHaveLength(1);
    expect(result.skippedNodes).toHaveLength(1);
    expect(result.skippedNodes[0]).toBe(nodeB.nodeId);
  });

  it('handles local_control nodes — immediate completion, no dispatch', async () => {
    const orchestratorActorId = uuid();
    const node = makeNode({
      planOrderIndex: 0,
      nodeType: 'local_control',
      agentId: orchestratorActorId,
      requiresNvg: false,
      requiresNxs: false,
    });
    const plan = makePlan([node]);
    const state = makeState(plan, []); // no delegations needed

    const dispatchFn = vi.fn();
    const deps = makeDeps({ dispatchNode: dispatchFn });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(dispatchFn).not.toHaveBeenCalled();
    expect(result.completedNodes).toHaveLength(1);
  });

  it('fails node when delegation binding is missing', async () => {
    const node = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([node]);
    const state = makeState(plan, []); // empty delegations

    const deps = makeDeps();
    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.failedNodes).toHaveLength(1);
    const ns = state.nodeStatuses.find(s => s.nodeId === node.nodeId)!;
    expect(ns.status).toBe('failed');
    expect(ns.failureReason).toBe('delegation_missing');
  });
});

// ─── ORCH-06: Node timeout — node marked, dependents skipped ───

describe('ORCH-06: Node timeout', () => {
  it('marks timed-out node as timed_out', async () => {
    const node = makeNode({ planOrderIndex: 0, timeoutMs: 50 });
    const plan = makePlan([node]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(
        () => new Promise<NodeDispatchResult>(() => {}) // never resolves
      ),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.failedNodes).toHaveLength(1);
    const ns = state.nodeStatuses.find(s => s.nodeId === node.nodeId)!;
    expect(ns.status).toBe('timed_out');
  });

  it('skips dependent when sole dependency timed out', async () => {
    const nodeA = makeNode({ planOrderIndex: 0, timeoutMs: 50 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'data_dependency');
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
        if (node.nodeId === nodeA.nodeId) {
          // Simulate timeout by never resolving
          return new Promise(() => {});
        }
        return {
          success: true,
          completionMetadata: {},
          failureReason: null,
          governanceDenied: false,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    const nsA = state.nodeStatuses.find(s => s.nodeId === nodeA.nodeId)!;
    const nsB = state.nodeStatuses.find(s => s.nodeId === nodeB.nodeId)!;
    expect(nsA.status).toBe('timed_out');
    expect(nsB.status).toBe('skipped');
    expect(result.skippedNodes).toContain(nodeB.nodeId);
  });
});

// ─── ORCH-07: Replay determinism — same plan + outcomes → same runSequence ───

describe('ORCH-07: Replay determinism', () => {
  it('produces identical runSequence values for same plan and outcomes', async () => {
    const agentA = uuid();
    const agentB = uuid();

    const buildScenario = () => {
      const nodeA = makeNode({ planOrderIndex: 0, agentId: agentA });
      const nodeB = makeNode({ planOrderIndex: 1, agentId: agentB });
      const plan = makePlan([nodeA, nodeB]);
      // Force same planId/runId for comparison
      plan.planId = 'plan-replay-test' as Uuid;
      plan.runId = 'run-replay-test' as Uuid;
      nodeA.nodeId = 'node-a-replay' as Uuid;
      nodeB.nodeId = 'node-b-replay' as Uuid;
      return { plan, nodeA, nodeB };
    };

    const run = async (reversePromiseOrder: boolean) => {
      const { plan, nodeA, nodeB } = buildScenario();
      const state = makeState(plan);

      const deps = makeDeps({
        dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
          // Simulate different physical completion times
          if (reversePromiseOrder && node.nodeId === nodeA.nodeId) {
            await new Promise(r => setTimeout(r, 10));
          } else if (!reversePromiseOrder && node.nodeId === nodeB.nodeId) {
            await new Promise(r => setTimeout(r, 10));
          }
          return {
            success: true,
            completionMetadata: {},
            failureReason: null,
            governanceDenied: false,
          };
        }),
      });

      const executor = new RefDagExecutor(defaultPartial);
      await executor.execute(state, deps);
      return state.nodeStatuses.map(ns => ({
        nodeId: ns.nodeId,
        runSequence: ns.runSequence,
        status: ns.status,
      }));
    };

    const run1 = await run(false);
    const run2 = await run(true);

    // runSequence values must be identical regardless of promise order
    for (const ns1 of run1) {
      const ns2 = run2.find(n => n.nodeId === ns1.nodeId)!;
      expect(ns2.runSequence).toBe(ns1.runSequence);
    }
  });
});

// ─── ORCH-08: Anti-recursion — governance deny does not trigger re-plan ───

describe('ORCH-08: Anti-recursion', () => {
  it('marks governance-denied node as failed with governanceDenied=true', async () => {
    const node = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([node]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(
        async (): Promise<NodeDispatchResult> => ({
          success: false,
          completionMetadata: null,
          failureReason: 'NXS_POLICY_DENIED' as NonEmpty,
          governanceDenied: true,
        })
      ),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.failedNodes).toHaveLength(1);
    const ns = state.nodeStatuses.find(s => s.nodeId === node.nodeId)!;
    expect(ns.status).toBe('failed');
    expect(ns.governanceDenied).toBe(true);
    expect(ns.failureReason).toBe('NXS_POLICY_DENIED');
  });

  it('does not re-dispatch after governance denial — executor terminates normally', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    // B depends on A
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'data_dependency');
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    let dispatchCount = 0;
    const deps = makeDeps({
      dispatchNode: vi.fn(async (): Promise<NodeDispatchResult> => {
        dispatchCount++;
        return {
          success: false,
          completionMetadata: null,
          failureReason: 'NXS_DENIED' as NonEmpty,
          governanceDenied: true,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    // Only A dispatched, B never dispatched (skipped because A failed)
    expect(dispatchCount).toBe(1);
    expect(result.failedNodes).toContain(nodeA.nodeId);
    // B should be skipped since its dependency failed
    expect(result.skippedNodes).toContain(nodeB.nodeId);
  });
});

// ─── ORCH-12: Cancel — executor cancel behavior ───

describe('ORCH-12: Cancel', () => {
  it('cancel before any dispatch — all nodes skipped', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const plan = makePlan([nodeA, nodeB]);
    const state = makeState(plan);
    state.cancelled = true; // cancel before execute

    const dispatchFn = vi.fn();
    const deps = makeDeps({ dispatchNode: dispatchFn });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(dispatchFn).not.toHaveBeenCalled();
    expect(result.skippedNodes).toHaveLength(2);
    expect(result.completedNodes).toHaveLength(0);
    expect(result.failedNodes).toHaveLength(0);
    expect(state.cancelled).toBe(true);
  });

  it('cancel during in-flight — in-flight completes, pending/ready skipped', async () => {
    const nodeA = makeNode({ planOrderIndex: 0 });
    const nodeB = makeNode({ planOrderIndex: 1 });
    const edge = makeEdge(nodeA.nodeId, nodeB.nodeId, 'data_dependency');
    const plan = makePlan([nodeA, nodeB], [edge]);
    const state = makeState(plan);

    const deps = makeDeps({
      dispatchNode: vi.fn(async (node: PlanNode): Promise<NodeDispatchResult> => {
        if (node.nodeId === nodeA.nodeId) {
          // Cancel during A's dispatch
          state.cancelled = true;
        }
        return {
          success: true,
          completionMetadata: {},
          failureReason: null,
          governanceDenied: false,
        };
      }),
    });

    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    // A completes (was in-flight when cancel set)
    expect(result.completedNodes).toContain(nodeA.nodeId);
    // B never dispatched — either skipped or still pending
    const nsB = state.nodeStatuses.find(s => s.nodeId === nodeB.nodeId)!;
    expect(['skipped', 'pending']).toContain(nsB.status);
  });

  it('cancelled state is preserved in finalState', async () => {
    const node = makeNode({ planOrderIndex: 0 });
    const plan = makePlan([node]);
    const state = makeState(plan);
    state.cancelled = true;

    const deps = makeDeps();
    const executor = new RefDagExecutor(defaultPartial);
    const result = await executor.execute(state, deps);

    expect(result.finalState.cancelled).toBe(true);
  });
});

// ─── ORCH-22: dag_failed vs dag_partial_complete classification ───

describe('ORCH-22: DAG completion classification', () => {
  it('dag_completed when no failures', () => {
    const result = classifyDagCompletion({
      cancelled: false,
      completedCount: 3,
      failedCount: 0,
      skippedCount: 0,
      partialCompletion: { enabled: false, minRequiredCompletedNodes: 0, compileOnPartial: false },
    });
    expect(result).toBe('dag_completed');
  });

  it('dag_failed when failures and partial not enabled', () => {
    const result = classifyDagCompletion({
      cancelled: false,
      completedCount: 1,
      failedCount: 2,
      skippedCount: 0,
      partialCompletion: { enabled: false, minRequiredCompletedNodes: 0, compileOnPartial: false },
    });
    expect(result).toBe('dag_failed');
  });

  it('dag_failed when failures and partial enabled but compileOnPartial=false', () => {
    const result = classifyDagCompletion({
      cancelled: false,
      completedCount: 2,
      failedCount: 1,
      skippedCount: 0,
      partialCompletion: { enabled: true, minRequiredCompletedNodes: 1, compileOnPartial: false },
    });
    expect(result).toBe('dag_failed');
  });

  it('dag_partial_complete when failures + partial enabled + compileOnPartial=true + completed > 0', () => {
    const result = classifyDagCompletion({
      cancelled: false,
      completedCount: 2,
      failedCount: 1,
      skippedCount: 0,
      partialCompletion: { enabled: true, minRequiredCompletedNodes: 1, compileOnPartial: true },
    });
    expect(result).toBe('dag_partial_complete');
  });

  it('dag_failed when zero completed even with partial enabled', () => {
    const result = classifyDagCompletion({
      cancelled: false,
      completedCount: 0,
      failedCount: 3,
      skippedCount: 0,
      partialCompletion: { enabled: true, minRequiredCompletedNodes: 1, compileOnPartial: true },
    });
    expect(result).toBe('dag_failed');
  });
});
