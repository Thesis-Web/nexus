// packages/orch-ref/src/validate-plan.ts
// AMEND-spec-nexus-orch §7.2.1 — Planner Output Validation
// External reference — imports @nexus/contracts ONLY.
//
// Runs at coordinator trust boundary before plan_created.
// Planner is pluggable [blueprint-K §11.4.3]; coordinator MUST NOT
// trust planner output without validation.

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  ExecutionPlan,
  PlanNode,
  PlanEdge,
  OrchestratorManifestRecord,
} from '@nexus/contracts';

import type { WorkspaceRunRequest } from '@nexus/contracts';

// ─── Validation Result ───

export interface PlanValidationResult {
  failed: boolean;
  reason: NonEmpty | null;
}

const OK: PlanValidationResult = { failed: false, reason: null };

function fail(reason: string): PlanValidationResult {
  return { failed: true, reason: reason as NonEmpty };
}

// ─── Edge Sort Comparator (matching §5.1 step 10 from planner) ───

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

// ─── validateExecutionPlan — 14 checks per §7.2.1 ───

export function validateExecutionPlan(
  plan: ExecutionPlan,
  request: WorkspaceRunRequest,
  manifest: OrchestratorManifestRecord,
  computeDigest: (obj: unknown) => Sha256Hex,
  orchestratorActorId: Uuid
): PlanValidationResult {
  // Check 1: plan.runId === request.runId
  if (plan.runId !== request.runId) {
    return fail(
      `Check 1: plan.runId '${plan.runId}' does not match request.runId '${request.runId}'`
    );
  }

  // Check 2: planDigest re-derives exactly per §3.2 digest law
  const expectedDigest = computeDigest({
    planId: plan.planId,
    runId: plan.runId,
    nodes: [...plan.nodes].sort((a, b) => a.planOrderIndex - b.planOrderIndex),
    edges: [...plan.edges].sort(compareEdges),
    plannerType: plan.plannerType,
    plannerVersion: plan.plannerVersion,
  });
  if (plan.planDigest !== expectedDigest) {
    return fail('Check 2: planDigest does not match re-derived digest');
  }

  // Check 3: nodes sorted by planOrderIndex
  for (let i = 1; i < plan.nodes.length; i++) {
    const previous = plan.nodes[i - 1];
    const current = plan.nodes[i];

    if (!previous || !current) {
      return fail(`Check 3: missing node at index ${i}`);
    }

    if (current.planOrderIndex <= previous.planOrderIndex) {
      return fail('Check 3: nodes not sorted by planOrderIndex');
    }
  }

  // Check 4: planOrderIndex values unique and contiguous (0, 1, 2, ...)
  for (let i = 0; i < plan.nodes.length; i++) {
    const current = plan.nodes[i];

    if (!current) {
      return fail(`Check 4: missing node at index ${i}`);
    }

    if (current.planOrderIndex !== i) {
      return fail(
        `Check 4: planOrderIndex not contiguous — expected ${i}, got ${current.planOrderIndex}`
      );
    }
  }

  // Check 5: nodeId values are unique
  const nodeIdSet = new Set<string>();
  for (const node of plan.nodes) {
    if (nodeIdSet.has(node.nodeId)) {
      return fail(`Check 5: duplicate nodeId '${node.nodeId}'`);
    }
    nodeIdSet.add(node.nodeId);
  }

  // Check 6: edgeId values are unique
  const edgeIdSet = new Set<string>();
  for (const edge of plan.edges) {
    if (edgeIdSet.has(edge.edgeId)) {
      return fail(`Check 6: duplicate edgeId '${edge.edgeId}'`);
    }
    edgeIdSet.add(edge.edgeId);
  }

  // Check 7: all edge sourceNodeId/targetNodeId reference existing nodes
  for (const edge of plan.edges) {
    if (!nodeIdSet.has(edge.sourceNodeId)) {
      return fail(`Check 7: edge sourceNodeId '${edge.sourceNodeId}' references non-existent node`);
    }
    if (!nodeIdSet.has(edge.targetNodeId)) {
      return fail(`Check 7: edge targetNodeId '${edge.targetNodeId}' references non-existent node`);
    }
  }

  // Check 8: graph is acyclic
  if (plan.edges.length > 0 && hasCycle(plan.nodes, plan.edges)) {
    return fail('Check 8: plan edges form a cycle — DAG required');
  }

  // Check 9: edge sort order matches [sourceNodeId, targetNodeId, edgeType, edgeId]
  for (let i = 1; i < plan.edges.length; i++) {
    const previous = plan.edges[i - 1];
    const current = plan.edges[i];

    if (!previous || !current) {
      return fail(`Check 9: missing edge at index ${i}`);
    }

    if (compareEdges(previous, current) > 0) {
      return fail('Check 9: edges not sorted by [sourceNodeId, targetNodeId, edgeType, edgeId]');
    }
  }

  // Check 10: no node has requiresNvg=true AND requiresNxs=true
  for (const node of plan.nodes) {
    if (node.requiresNvg && node.requiresNxs) {
      return fail(`Check 10: node '${node.nodeId}' has both requiresNvg and requiresNxs true`);
    }
  }

  // Check 11: nodeType matches requiresNvg/requiresNxs per dispatch law [§5.4]
  for (const node of plan.nodes) {
    if (node.requiresNvg && node.nodeType !== 'nvg_dispatch') {
      return fail(
        `Check 11: node '${node.nodeId}' requiresNvg=true but nodeType='${node.nodeType}'`
      );
    }
    if (node.requiresNxs && node.nodeType !== 'nxs_dispatch') {
      return fail(
        `Check 11: node '${node.nodeId}' requiresNxs=true but nodeType='${node.nodeType}'`
      );
    }
    if (
      !node.requiresNvg &&
      !node.requiresNxs &&
      node.nodeType !== 'local_control' &&
      node.nodeType !== 'secure_agent_handoff'
    ) {
      return fail(`Check 11: node '${node.nodeId}' both false but nodeType='${node.nodeType}'`);
    }
  }

  // Check 12: local_control node agentId equals orchestratorActorId
  for (const node of plan.nodes) {
    if (node.nodeType === 'local_control' && node.agentId !== orchestratorActorId) {
      return fail(
        `Check 12: local_control node '${node.nodeId}' agentId does not match orchestratorActorId`
      );
    }
  }

  // Check 13: secure_agent_handoff: taskSummary === 'OCT_SECURE_REDACTED'
  for (const node of plan.nodes) {
    if (node.nodeType === 'secure_agent_handoff') {
      if (node.taskSummary !== 'OCT_SECURE_REDACTED') {
        return fail(
          `Check 13: secure_agent_handoff node '${node.nodeId}' taskSummary is not 'OCT_SECURE_REDACTED'`
        );
      }
    }
  }

  // Check 14: nodes.length <= manifest.maxSplitDepth
  if (plan.nodes.length > manifest.maxSplitDepth) {
    return fail(
      `Check 14: plan has ${plan.nodes.length} nodes but maxSplitDepth is ${manifest.maxSplitDepth}`
    );
  }

  // Check 15: every nxs_dispatch slotBinding has a matching inputSlotReads
  //           entry. Keeps the slot-substitution audit trail explicit on
  //           both sides — the planner declared the read AND the binding,
  //           the dispatcher resolves only what was declared.
  for (const node of plan.nodes) {
    if (node.nodeType !== 'nxs_dispatch') continue;
    const bindings = node.actionTemplate?.slotBindings;
    if (!bindings || bindings.length === 0) continue;
    const reads = node.inputSlotReads ?? [];
    const readsByKeySlot = new Set(reads.map(r => `${r.fromSubTaskKey}::${r.slotId}`));
    for (const b of bindings) {
      const key = `${b.fromSubTaskKey}::${b.slotId}`;
      if (!readsByKeySlot.has(key)) {
        return fail(
          `Check 15: node '${node.nodeId}' slotBinding (fromSubTaskKey='${b.fromSubTaskKey}', slotId='${b.slotId}') has no matching inputSlotReads entry`
        );
      }
    }
  }

  return OK;
}
