// packages/orch-ref/src/plan-amendment.ts
// AMEND-spec-nexus-orch §8 — Plan Amendment
// External reference — imports @nexus/contracts ONLY.
//
// Implements [blueprint-K §11.6.6].
//
// Deterministic merge law [§8.2]:
// - Extension runId must equal current plan runId
// - No nodeId/edgeId collisions
// - planOrderIndex rebased from max(existing) + 1
// - Merged plan validated for acyclicity
// - Merged planDigest recomputed over full merged plan
// - New edges must not target already-terminal nodes

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  ExecutionPlan,
  PlanNode,
  PlanEdge,
  NodeStatusType,
  RunDagState,
  NodeDelegationBinding,
  OrchestratorManifestRecord,
} from '@nexus/contracts';

import type { DelegationScope } from './run-coordinator.js';

// ─── Amendment Types ───

export interface AmendmentDeps {
  computeDigest: (obj: unknown) => Sha256Hex;
  issueDelegation: (agentId: Uuid, scope: DelegationScope) => Promise<Uuid>;
  writeLedgerEvent: (eventType: string, detail: Record<string, unknown>) => Promise<void>;
  sendPlanCheckback: (preview: unknown) => Promise<boolean>;
}

export interface AmendmentResult {
  success: boolean;
  mergedPlan: ExecutionPlan | null;
  newDelegationBindings: NodeDelegationBinding[];
  reason: NonEmpty | null;
}

export interface MergeValidationResult {
  failed: boolean;
  reason: NonEmpty | null;
}

// ─── Edge Sort Comparator ───

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

// ─── Acyclicity Check ───

function hasCycle(nodes: PlanNode[], edges: PlanEdge[]): boolean {
  const nodeIds = new Set(nodes.map(n => n.nodeId));
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const id of nodeIds) {
    if (dfs(id)) return true;
  }
  return false;
}

// ─── Terminal status set ───

const TERMINAL_STATUSES: ReadonlySet<NodeStatusType> = new Set([
  'completed',
  'failed',
  'timed_out',
  'skipped',
]);

// ─── validateMerge — Dry-run merge validation [§8.2] ───

export function validateMerge(
  currentPlan: ExecutionPlan,
  extension: ExecutionPlan,
  currentState: RunDagState
): MergeValidationResult {
  const ok: MergeValidationResult = { failed: false, reason: null };
  const fail = (reason: string): MergeValidationResult => ({
    failed: true,
    reason: reason as NonEmpty,
  });

  // §8.2.1: extension.runId must equal current plan runId
  if (extension.runId !== currentPlan.runId) {
    return fail('extension.runId does not match current plan runId');
  }

  // §8.2.2: nodeId collision check
  const existingNodeIds = new Set(currentPlan.nodes.map(n => n.nodeId));
  for (const node of extension.nodes) {
    if (existingNodeIds.has(node.nodeId)) {
      return fail(`nodeId collision: '${node.nodeId}' exists in current plan`);
    }
  }

  // §8.2.2: edgeId collision check
  const existingEdgeIds = new Set(currentPlan.edges.map(e => e.edgeId));
  for (const edge of extension.edges) {
    if (existingEdgeIds.has(edge.edgeId)) {
      return fail(`edgeId collision: '${edge.edgeId}' exists in current plan`);
    }
  }

  // §8.2.4: extension edge node references — all must exist in combined plan
  const combinedNodeIds = new Set([...existingNodeIds, ...extension.nodes.map(n => n.nodeId)]);
  for (const edge of extension.edges) {
    if (!combinedNodeIds.has(edge.sourceNodeId)) {
      return fail(`extension edge sourceNodeId '${edge.sourceNodeId}' not in combined plan`);
    }
    if (!combinedNodeIds.has(edge.targetNodeId)) {
      return fail(`extension edge targetNodeId '${edge.targetNodeId}' not in combined plan`);
    }
  }

  // §8.2.9: new edges must not target already-terminal nodes
  for (const edge of extension.edges) {
    // Only check edges targeting existing nodes (extension-to-existing edges)
    if (existingNodeIds.has(edge.targetNodeId)) {
      const targetStatus = currentState.nodeStatuses.find(ns => ns.nodeId === edge.targetNodeId);
      if (targetStatus && TERMINAL_STATUSES.has(targetStatus.status)) {
        return fail(
          `extension edge targets terminal node '${edge.targetNodeId}' (status: ${targetStatus.status})`
        );
      }
    }
  }

  // §8.2.5: merged plan must be acyclic (pre-check with rebased indices)
  const maxIndex = currentPlan.nodes.reduce((max, n) => Math.max(max, n.planOrderIndex), -1);
  const rebasedExtNodes = extension.nodes.map((n, i) => ({
    ...n,
    planOrderIndex: maxIndex + 1 + i,
  }));
  const mergedNodes = [...currentPlan.nodes, ...rebasedExtNodes];
  const mergedEdges = [...currentPlan.edges, ...extension.edges];

  if (hasCycle(mergedNodes, mergedEdges)) {
    return fail('merged plan forms a cycle — DAG required');
  }

  return ok;
}

// ─── mergePlans — Commit merge [§8.2] ───

export function mergePlans(
  currentPlan: ExecutionPlan,
  extension: ExecutionPlan,
  computeDigest: (obj: unknown) => Sha256Hex
): ExecutionPlan {
  // §8.2.3: rebase planOrderIndex
  const maxIndex = currentPlan.nodes.reduce((max, n) => Math.max(max, n.planOrderIndex), -1);

  const rebasedExtNodes: PlanNode[] = extension.nodes.map((n, i) => ({
    ...n,
    planOrderIndex: maxIndex + 1 + i,
  }));

  const mergedNodes = [...currentPlan.nodes, ...rebasedExtNodes].sort(
    (a, b) => a.planOrderIndex - b.planOrderIndex
  );

  const mergedEdges = [...currentPlan.edges, ...extension.edges].sort(compareEdges);

  // §8.2.6: recompute planDigest over full merged plan. Carry the
  // current plan's output contract template choice (if any) into the
  // amended plan's digest — amendment cannot change template choice.
  const mergedDigest = computeDigest({
    planId: currentPlan.planId,
    runId: currentPlan.runId,
    nodes: mergedNodes,
    edges: mergedEdges,
    plannerType: currentPlan.plannerType,
    plannerVersion: currentPlan.plannerVersion,
    ...(currentPlan.outputContractTemplateId !== undefined
      ? { outputContractTemplateId: currentPlan.outputContractTemplateId }
      : {}),
    ...(currentPlan.outputContractTemplateVersion !== undefined
      ? { outputContractTemplateVersion: currentPlan.outputContractTemplateVersion }
      : {}),
  });

  return {
    planId: currentPlan.planId,
    runId: currentPlan.runId,
    planDigest: mergedDigest,
    nodes: mergedNodes,
    edges: mergedEdges,
    plannerType: currentPlan.plannerType,
    plannerVersion: currentPlan.plannerVersion,
    createdAt: currentPlan.createdAt,
    // Amendment preserves the original template choice — orch cannot
    // change the contract mid-run; the user/planner picked it at plan-time.
    ...(currentPlan.outputContractTemplateId !== undefined
      ? { outputContractTemplateId: currentPlan.outputContractTemplateId }
      : {}),
    ...(currentPlan.outputContractTemplateVersion !== undefined
      ? { outputContractTemplateVersion: currentPlan.outputContractTemplateVersion }
      : {}),
  };
}

// ─── scopeFromPlanNode ───

function scopeFromPlanNode(node: PlanNode): DelegationScope {
  return {
    taskSummary: node.taskSummary,
    requiresNvg: node.requiresNvg,
    requiresNxs: node.requiresNxs,
    nodeType: node.nodeType,
    expectedOutputSlots: node.expectedOutputSlots,
  };
}

// ─── countDispatchableNodes ───

function countDispatchableNodes(plan: ExecutionPlan): number {
  return plan.nodes.filter(n => n.nodeType !== 'local_control').length;
}

// ─── requiresGovernanceReCheck [§8.1] ───

function requiresGovernanceReCheck(extension: ExecutionPlan, currentPlan: ExecutionPlan): boolean {
  const existingAgentIds = new Set(currentPlan.nodes.map(n => n.agentId));

  for (const node of extension.nodes) {
    // New agent not in original plan
    if (!existingAgentIds.has(node.agentId)) return true;
    // External-facing or higher OCT path would be checked via node properties
    // V1: new agent is the primary trigger
  }

  return false;
}

// ─── PlanAmendmentHandler ───

export class PlanAmendmentHandler {
  constructor(
    private readonly manifest: OrchestratorManifestRecord,
    private readonly deps: AmendmentDeps
  ) {}

  async handleAmendment(
    currentState: RunDagState,
    amendmentPlan: ExecutionPlan
  ): Promise<AmendmentResult> {
    const currentPlan = currentState.plan;

    // Check maxAmendments [ORCH-10]
    if (currentState.amendmentCount >= this.manifest.planAmendment.maxAmendments) {
      await this.deps.writeLedgerEvent('plan_amended', {
        approved: false,
        reason: 'max_amendments_exceeded',
        originalPlanId: currentPlan.planId,
        originalPlanDigest: currentPlan.planDigest,
        amendmentPlanId: amendmentPlan.planId,
        amendmentPlanDigest: amendmentPlan.planDigest,
      });
      return {
        success: false,
        mergedPlan: null,
        newDelegationBindings: [],
        reason: 'max_amendments_exceeded' as NonEmpty,
      };
    }

    // Governance re-check [ORCH-09]
    const needsReCheck = requiresGovernanceReCheck(amendmentPlan, currentPlan);
    if (needsReCheck && this.manifest.planAmendment.requiresCheckback) {
      const confirmed = await this.deps.sendPlanCheckback(amendmentPlan);
      if (!confirmed) {
        await this.deps.writeLedgerEvent('plan_amended', {
          approved: false,
          reason: 'checkback_rejected',
          originalPlanId: currentPlan.planId,
          originalPlanDigest: currentPlan.planDigest,
          amendmentPlanId: amendmentPlan.planId,
          amendmentPlanDigest: amendmentPlan.planDigest,
        });
        return {
          success: false,
          mergedPlan: null,
          newDelegationBindings: [],
          reason: 'checkback_rejected' as NonEmpty,
        };
      }
    }

    // Step 1: Validate merge invariants BEFORE issuing delegations [§8.2]
    const mergeValidation = validateMerge(currentPlan, amendmentPlan, currentState);
    if (mergeValidation.failed) {
      await this.deps.writeLedgerEvent('plan_amended', {
        approved: false,
        reason: mergeValidation.reason,
        originalPlanId: currentPlan.planId,
        originalPlanDigest: currentPlan.planDigest,
        amendmentPlanId: amendmentPlan.planId,
        amendmentPlanDigest: amendmentPlan.planDigest,
      });
      return {
        success: false,
        mergedPlan: null,
        newDelegationBindings: [],
        reason: mergeValidation.reason,
      };
    }

    // Step 2: Issue delegations for new dispatchable nodes [§8.1]
    const newBindings: NodeDelegationBinding[] = [];
    for (const node of amendmentPlan.nodes) {
      if (node.nodeType !== 'local_control') {
        const delegationId = await this.deps.issueDelegation(node.agentId, scopeFromPlanNode(node));
        newBindings.push({
          nodeId: node.nodeId,
          agentId: node.agentId,
          delegationId,
        });
      }
    }

    const expectedDispatchable = countDispatchableNodes(amendmentPlan);
    if (newBindings.length < expectedDispatchable) {
      await this.deps.writeLedgerEvent('plan_amended', {
        approved: false,
        reason: 'delegation_binding_failure',
        originalPlanId: currentPlan.planId,
        originalPlanDigest: currentPlan.planDigest,
        amendmentPlanId: amendmentPlan.planId,
        amendmentPlanDigest: amendmentPlan.planDigest,
      });
      return {
        success: false,
        mergedPlan: null,
        newDelegationBindings: [],
        reason: 'delegation_binding_failure' as NonEmpty,
      };
    }

    // Step 3: Commit merge [§8.2]
    const mergedPlan = mergePlans(currentPlan, amendmentPlan, this.deps.computeDigest);

    // Update state
    currentState.plan = mergedPlan;
    currentState.nodeDelegations.push(...newBindings);

    // Add NodeStatus entries for new nodes
    const maxExistingIndex = currentPlan.nodes.reduce(
      (max, n) => Math.max(max, n.planOrderIndex),
      -1
    );
    for (let i = 0; i < amendmentPlan.nodes.length; i++) {
      const node = amendmentPlan.nodes[i];
      if (!node) {
        throw new Error(`Missing amendment plan node at index ${i}`);
      }

      currentState.nodeStatuses.push({
        nodeId: node.nodeId,
        planOrderIndex: maxExistingIndex + 1 + i,
        status: 'pending',
        runSequence: 0,
        completionMetadata: null,
        failureReason: null,
        governanceDenied: false,
      });
    }
    // Re-sort by planOrderIndex
    currentState.nodeStatuses.sort((a, b) => a.planOrderIndex - b.planOrderIndex);

    currentState.amendmentCount++;

    await this.deps.writeLedgerEvent('plan_amended', {
      approved: true,
      originalPlanId: currentPlan.planId,
      originalPlanDigest: currentPlan.planDigest,
      amendmentPlanId: amendmentPlan.planId,
      amendmentPlanDigest: amendmentPlan.planDigest,
      mergedPlanId: mergedPlan.planId,
      mergedPlanDigest: mergedPlan.planDigest,
      newNodeCount: amendmentPlan.nodes.length,
      newEdgeCount: amendmentPlan.edges.length,
    });

    return {
      success: true,
      mergedPlan,
      newDelegationBindings: newBindings,
      reason: null,
    };
  }
}
