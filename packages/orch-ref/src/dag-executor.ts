// packages/orch-ref/src/dag-executor.ts
// AMEND-spec-nexus-orch §6 — DAG Executor
// External reference — imports @nexus/contracts ONLY.
//
// Implements DAG execution law [blueprint-K §11.6.2].
//
// Deterministic ordering rules [§6.2]:
// - Ready-node dispatch order MUST be sorted by planOrderIndex.
// - Completion result application MUST be sorted by planOrderIndex
//   before mutating RunDagState or incrementing runSequenceCounter.
// - Promise physical completion order MUST NOT determine runSequence.
//
// Anti-recursion law [blueprint-K §11.7.4]:
// - Governance-denied nodes are marked failed.
// - The executor MUST NOT trigger re-plan on governance denial.

import type {
  Uuid,
  NonEmpty,
  PlanNode,
  PlanEdge,
  PlanCondition,
  NodeStatus,
  NodeStatusType,
  RunDagState,
} from '@nexus/contracts';

// ─── Executor Interfaces — orch-ref-internal [§6.1] ───

export interface DagExecutorDeps {
  dispatchNode: (node: PlanNode, delegationId: Uuid) => Promise<NodeDispatchResult>;
  resolveCondition: (condition: PlanCondition, sourceMetadata: Record<string, unknown>) => boolean;
  onNodeEvent: (nodeId: Uuid, status: NodeStatus) => Promise<void>;
}

export interface NodeDispatchResult {
  success: boolean;
  completionMetadata: Record<string, unknown> | null;
  failureReason: NonEmpty | null;
  governanceDenied: boolean;
}

export interface DagExecutor {
  execute(state: RunDagState, deps: DagExecutorDeps): Promise<DagExecutionResult>;
}

export interface DagExecutionResult {
  finalState: RunDagState;
  completedNodes: Uuid[];
  failedNodes: Uuid[];
  skippedNodes: Uuid[];
}

// ─── Partial Completion Config (from manifest) ───

export interface PartialCompletionConfig {
  enabled: boolean;
  minRequiredCompletedNodes: number;
}

// ─── DAG Completion Classification — standalone [§4.9, ORCH-22] ───
// Called by RunCoordinator, NOT by executor. Exported for testing.

export interface DagClassificationInput {
  cancelled: boolean;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  partialCompletion: PartialCompletionConfig & { compileOnPartial: boolean };
}

export type DagClassification = 'dag_completed' | 'dag_partial_complete' | 'dag_failed';

export function classifyDagCompletion(input: DagClassificationInput): DagClassification {
  // §4.9: classification applies ONLY to non-cancelled runs.
  // Cancelled runs handled before this function is called.
  // Precondition: input.cancelled === false

  if (input.failedCount === 0) {
    return 'dag_completed';
  }

  if (
    input.completedCount > 0 &&
    input.partialCompletion.enabled &&
    input.partialCompletion.compileOnPartial
  ) {
    return 'dag_partial_complete';
  }

  return 'dag_failed';
}

// ─── Internal dispatch result with timeout sentinel ───

interface InternalDispatchResult {
  node: PlanNode;
  timedOut: boolean;
  result: NodeDispatchResult | null; // null when timed out
}

// ─── RefDagExecutor ───

export class RefDagExecutor implements DagExecutor {
  constructor(private readonly partialCompletionConfig: PartialCompletionConfig) {}

  async execute(state: RunDagState, deps: DagExecutorDeps): Promise<DagExecutionResult> {
    const completedNodes: Uuid[] = [];
    const failedNodes: Uuid[] = [];
    const skippedNodes: Uuid[] = [];

    // Identify root nodes (no incoming edges) and mark ready
    const targetNodeIds = new Set(state.plan.edges.map(e => e.targetNodeId));
    const rootNodes = state.plan.nodes
      .filter(n => !targetNodeIds.has(n.nodeId))
      .sort((a, b) => a.planOrderIndex - b.planOrderIndex);

    for (const node of rootNodes) {
      this.markStatus(state, node.nodeId, 'ready');
    }

    while (this.hasUnfinishedNodes(state)) {
      // Cancel check — FIRST, before any dispatch [§6.3, OD-ORCH-05]
      if (state.cancelled) {
        this.skipAllPendingAndReady(state, skippedNodes, deps);
        break;
      }

      // Get all ready nodes sorted by planOrderIndex
      const readyNodes = state.nodeStatuses
        .filter(ns => ns.status === 'ready')
        .sort((a, b) => a.planOrderIndex - b.planOrderIndex);

      // If no ready nodes and no dispatched nodes, we're blocked
      if (readyNodes.length === 0 && !state.nodeStatuses.some(ns => ns.status === 'dispatched')) {
        // Check partial completion
        if (this.partialCompletionConfig.enabled) {
          const completed = state.nodeStatuses.filter(ns => ns.status === 'completed').length;
          if (completed >= this.partialCompletionConfig.minRequiredCompletedNodes) {
            break;
          }
        }
        // Fully blocked, no partial — break
        break;
      }

      const dispatching: {
        node: PlanNode;
        delegationId: Uuid;
        promise: Promise<InternalDispatchResult>;
      }[] = [];

      for (const readyStatus of readyNodes) {
        const node = state.plan.nodes.find(n => n.nodeId === readyStatus.nodeId)!;

        // local_control: no external dispatch, no delegation needed [§6.2]
        if (node.nodeType === 'local_control') {
          this.markStatus(state, node.nodeId, 'completed', {});
          completedNodes.push(node.nodeId);
          const ns = this.getNodeStatus(state, node.nodeId);
          await deps.onNodeEvent(node.nodeId, ns);
          continue;
        }

        // Lookup delegation binding — missing = runtime violation [§6.2]
        const binding = state.nodeDelegations.find(b => b.nodeId === node.nodeId);
        if (!binding) {
          this.markStatus(state, node.nodeId, 'failed', null, 'delegation_missing' as NonEmpty);
          failedNodes.push(node.nodeId);
          const ns = this.getNodeStatus(state, node.nodeId);
          await deps.onNodeEvent(node.nodeId, ns);
          continue;
        }

        // Mark dispatched and emit event
        this.markStatus(state, node.nodeId, 'dispatched');
        const dispatchedNs = this.getNodeStatus(state, node.nodeId);
        await deps.onNodeEvent(node.nodeId, dispatchedNs);

        // Dispatch with timeout [§6.4]
        dispatching.push({
          node,
          delegationId: binding.delegationId,
          promise: this.dispatchWithTimeout(node, binding.delegationId, deps),
        });
      }

      if (dispatching.length === 0) {
        // No dispatches issued and no in-flight — blocked
        if (!state.nodeStatuses.some(ns => ns.status === 'dispatched')) {
          if (this.partialCompletionConfig.enabled) {
            const completed = state.nodeStatuses.filter(ns => ns.status === 'completed').length;
            if (completed >= this.partialCompletionConfig.minRequiredCompletedNodes) {
              break;
            }
          }
          break;
        }
        continue;
      }

      // Wait for all dispatched nodes to settle
      const settledResults = await Promise.allSettled(dispatching.map(d => d.promise));

      // CRITICAL: process results sorted by planOrderIndex, NOT promise order [§6.2]
      const resultPairs = dispatching
        .map((d, i) => ({ dispatch: d, settled: settledResults[i] }))
        .sort((a, b) => a.dispatch.node.planOrderIndex - b.dispatch.node.planOrderIndex);

      for (const { dispatch, settled } of resultPairs) {
        const nodeId = dispatch.node.nodeId;

        if (settled.status === 'rejected') {
          // Unexpected rejection — mark failed
          this.markStatus(
            state,
            nodeId,
            'failed',
            null,
            (String(settled.reason) || 'dispatch_error') as NonEmpty
          );
          failedNodes.push(nodeId);
          const ns = this.getNodeStatus(state, nodeId);
          await deps.onNodeEvent(nodeId, ns);
          continue;
        }

        const internalResult = settled.value;

        if (internalResult.timedOut) {
          // Timeout — mark timed_out [§6.4]
          this.markStatus(state, nodeId, 'timed_out');
          failedNodes.push(nodeId);
          const ns = this.getNodeStatus(state, nodeId);
          await deps.onNodeEvent(nodeId, ns);
          continue;
        }

        const result = internalResult.result!;

        if (result.success) {
          this.markStatus(state, nodeId, 'completed', result.completionMetadata);
          completedNodes.push(nodeId);
          const ns = this.getNodeStatus(state, nodeId);
          await deps.onNodeEvent(nodeId, ns);
        } else if (result.governanceDenied) {
          // Anti-recursion: mark failed, do NOT re-plan [blueprint-K §11.7.4]
          this.markStatus(state, nodeId, 'failed', null, result.failureReason, true);
          failedNodes.push(nodeId);
          const ns = this.getNodeStatus(state, nodeId);
          await deps.onNodeEvent(nodeId, ns);
        } else {
          // Generic failure
          this.markStatus(state, nodeId, 'failed', null, result.failureReason);
          failedNodes.push(nodeId);
          const ns = this.getNodeStatus(state, nodeId);
          await deps.onNodeEvent(nodeId, ns);
        }
      }

      // Resolve dependencies — sorted by planOrderIndex of target [§6.2]
      this.resolveDependencies(state, deps, skippedNodes);

      // Post-dispatch cancel check — catches cancel during in-flight await [§6.3]
      if (state.cancelled) {
        this.skipAllPendingAndReady(state, skippedNodes, deps);
        break;
      }

      // Check partial completion — all remaining blocked [§6.2]
      if (this.allRemainingBlocked(state)) {
        if (this.partialCompletionConfig.enabled) {
          const completed = state.nodeStatuses.filter(ns => ns.status === 'completed').length;
          if (completed >= this.partialCompletionConfig.minRequiredCompletedNodes) {
            break;
          }
        }
        break;
      }
    }

    return {
      finalState: state,
      completedNodes,
      failedNodes,
      skippedNodes,
    };
  }

  // ─── dispatchWithTimeout [§6.4] ───

  private async dispatchWithTimeout(
    node: PlanNode,
    delegationId: Uuid,
    deps: DagExecutorDeps
  ): Promise<InternalDispatchResult> {
    const timeoutPromise = new Promise<InternalDispatchResult>(resolve => {
      setTimeout(() => {
        resolve({ node, timedOut: true, result: null });
      }, node.timeoutMs);
    });

    const dispatchPromise = deps.dispatchNode(node, delegationId).then(
      (result): InternalDispatchResult => ({
        node,
        timedOut: false,
        result,
      })
    );

    return Promise.race([dispatchPromise, timeoutPromise]);
  }

  // ─── Dependency resolution [§6.2] ───

  private resolveDependencies(
    state: RunDagState,
    deps: DagExecutorDeps,
    skippedNodes: Uuid[]
  ): void {
    // Get edges from completed/failed/timed_out/skipped source nodes
    // Target nodes sorted by planOrderIndex
    const terminalStatuses: ReadonlySet<NodeStatusType> = new Set([
      'completed',
      'failed',
      'timed_out',
      'skipped',
    ]);

    const terminalNodeIds = new Set(
      state.nodeStatuses.filter(ns => terminalStatuses.has(ns.status)).map(ns => ns.nodeId)
    );

    // Find edges where source is terminal and target is still pending
    const pendingEdges = state.plan.edges
      .filter(edge => {
        if (!terminalNodeIds.has(edge.sourceNodeId)) return false;
        const targetStatus = state.nodeStatuses.find(ns => ns.nodeId === edge.targetNodeId);
        return targetStatus?.status === 'pending';
      })
      .sort((a, b) => {
        const aNode = state.nodeStatuses.find(ns => ns.nodeId === a.targetNodeId)!;
        const bNode = state.nodeStatuses.find(ns => ns.nodeId === b.targetNodeId)!;
        return aNode.planOrderIndex - bNode.planOrderIndex;
      });

    for (const edge of pendingEdges) {
      const targetNodeId = edge.targetNodeId;
      const targetStatus = state.nodeStatuses.find(ns => ns.nodeId === targetNodeId);
      if (!targetStatus || targetStatus.status !== 'pending') continue;

      if (edge.edgeType === 'data_dependency' || edge.edgeType === 'sequential') {
        // Check if source completed successfully
        const sourceStatus = state.nodeStatuses.find(ns => ns.nodeId === edge.sourceNodeId);
        if (
          sourceStatus &&
          (sourceStatus.status === 'failed' ||
            sourceStatus.status === 'timed_out' ||
            sourceStatus.status === 'skipped')
        ) {
          // Dependent on failed/timed_out/skipped source → skip [§6.4]
          if (this.allIncomingSourcesTerminal(state, targetNodeId)) {
            const hasAnyCompletedSource = this.hasCompletedIncomingSource(state, targetNodeId);
            if (!hasAnyCompletedSource) {
              this.markStatus(
                state,
                targetNodeId,
                'skipped',
                null,
                'dependency_failed' as NonEmpty
              );
              skippedNodes.push(targetNodeId);
              continue;
            }
          }
        }

        // Check if all incoming edges for target are resolved
        if (this.allIncomingEdgesResolved(state, targetNodeId)) {
          this.markStatus(state, targetNodeId, 'ready');
        }
      } else if (edge.edgeType === 'conditional') {
        if (!edge.condition) continue;

        // Get source node's completion metadata
        const sourceStatus = state.nodeStatuses.find(ns => ns.nodeId === edge.sourceNodeId);
        const sourceMetadata = sourceStatus?.completionMetadata ?? ({} as Record<string, unknown>);

        const condResult = deps.resolveCondition(
          edge.condition,
          sourceMetadata as Record<string, unknown>
        );

        if (condResult) {
          if (this.allIncomingEdgesResolved(state, targetNodeId)) {
            this.markStatus(state, targetNodeId, 'ready');
          }
        } else {
          this.markStatus(state, targetNodeId, 'skipped', null, 'condition_false' as NonEmpty);
          skippedNodes.push(targetNodeId);
        }
      }
    }
  }

  // ─── Helpers ───

  private hasUnfinishedNodes(state: RunDagState): boolean {
    return state.nodeStatuses.some(
      ns => ns.status === 'pending' || ns.status === 'ready' || ns.status === 'dispatched'
    );
  }

  private allRemainingBlocked(state: RunDagState): boolean {
    // No ready or dispatched nodes, but pending ones exist
    const hasReady = state.nodeStatuses.some(ns => ns.status === 'ready');
    const hasDispatched = state.nodeStatuses.some(ns => ns.status === 'dispatched');
    const hasPending = state.nodeStatuses.some(ns => ns.status === 'pending');
    return !hasReady && !hasDispatched && hasPending;
  }

  private allIncomingEdgesResolved(state: RunDagState, targetNodeId: Uuid): boolean {
    const incomingEdges = state.plan.edges.filter(e => e.targetNodeId === targetNodeId);
    if (incomingEdges.length === 0) return true;

    return incomingEdges.every(edge => {
      const sourceStatus = state.nodeStatuses.find(ns => ns.nodeId === edge.sourceNodeId);
      return (
        sourceStatus !== undefined &&
        (sourceStatus.status === 'completed' ||
          sourceStatus.status === 'failed' ||
          sourceStatus.status === 'timed_out' ||
          sourceStatus.status === 'skipped')
      );
    });
  }

  private allIncomingSourcesTerminal(state: RunDagState, targetNodeId: Uuid): boolean {
    return this.allIncomingEdgesResolved(state, targetNodeId);
  }

  private hasCompletedIncomingSource(state: RunDagState, targetNodeId: Uuid): boolean {
    const incomingEdges = state.plan.edges.filter(e => e.targetNodeId === targetNodeId);
    return incomingEdges.some(edge => {
      const sourceStatus = state.nodeStatuses.find(ns => ns.nodeId === edge.sourceNodeId);
      return sourceStatus?.status === 'completed';
    });
  }

  private markStatus(
    state: RunDagState,
    nodeId: Uuid,
    status: NodeStatusType,
    metadata?: Record<string, unknown> | null,
    failureReason?: NonEmpty | null,
    governanceDenied?: boolean
  ): void {
    const ns = state.nodeStatuses.find(n => n.nodeId === nodeId);
    if (!ns) return;

    state.runSequenceCounter++;
    ns.status = status;
    ns.runSequence = state.runSequenceCounter;

    if (metadata !== undefined) {
      ns.completionMetadata = metadata;
    }
    if (failureReason !== undefined) {
      ns.failureReason = failureReason;
    }
    if (governanceDenied !== undefined) {
      ns.governanceDenied = governanceDenied;
    }
  }

  private getNodeStatus(state: RunDagState, nodeId: Uuid): NodeStatus {
    return state.nodeStatuses.find(ns => ns.nodeId === nodeId)!;
  }

  private skipAllPendingAndReady(
    state: RunDagState,
    skippedNodes: Uuid[],
    deps: DagExecutorDeps
  ): void {
    const toSkip = state.nodeStatuses
      .filter(ns => ns.status === 'pending' || ns.status === 'ready')
      .sort((a, b) => a.planOrderIndex - b.planOrderIndex);

    for (const ns of toSkip) {
      this.markStatus(state, ns.nodeId, 'skipped', null, 'cancelled' as NonEmpty);
      skippedNodes.push(ns.nodeId);
      // Fire-and-forget event emission for cancel skips
      const updatedNs = this.getNodeStatus(state, ns.nodeId);
      void deps.onNodeEvent(ns.nodeId, updatedNs);
    }
  }
}
