// packages/orch-ref/src/plan-assembly.ts
// ExecutionPlan construction primitives — extracted from
// ref-deterministic-planner.ts per AMEND-nexus-planner-db-lexicon-v0-2-1.md
// §6.2 Commit 1 + log MODULAR-PLAN-ASSEMBLY-001.
//
// These functions are NOT planner-specific. Any Planner implementation
// needs them to turn validated agent/sub-task data into a well-formed
// ExecutionPlan. No behavior change vs. the originating file.
//
// V1 consumers: RefDeterministicPlanner (until Commit 6),
// DbLexiconTransformerPlanner (Commit 4 onward).
// V2 cleanup: extract to @nexus/orch-primitives package OR rename
// @nexus/orch-ref → @nexus/orch-runtime per THREAT-ORCH-REF-LAYER-001.

import { randomUUID } from 'node:crypto';
import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  AgentCapabilityEntry,
  EdgeHint,
  ExecutionPlan,
  MetadataPlannerRequest,
  NormalPlannerRequest,
  NxsActionTemplate,
  OctSecurePlannerRequest,
  PlanCondition,
  PlanConditionOperator,
  PlanEdge,
  PlanEdgeType,
  PlanNode,
  PlanRejection,
  PlanRejectionReason,
  PlannerContext,
  SubTaskDecl,
  SuggestedAgent,
} from '@nexus/contracts';
import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

// Per-node execution budget. The DAG executor races this against the
// node's full work-cycle, NOT a single NVG call. Within one nvg_dispatch
// node, the round-trip loop may invoke the model up to maxToolTurnsPerNode
// times (default 6), and each turn can take tens of seconds on small
// on-prem models. The previous 60_000 bound matched modelCallMs and so
// tripped on the first slow turn for open-ended prompts. 5 min gives
// headroom for ~5 sequential 60s turns; a single hung call still aborts
// at modelCallMs in the adapter layer.
export const NODE_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Valid PlanConditionOperator values ───

const VALID_OPERATORS: ReadonlySet<string> = new Set<string>([
  'equals',
  'not_equals',
  'exists',
  'not_exists',
  'gt',
  'lt',
]);

// ─── Planner dependencies ───
// Each plan-assembly function group takes the planner's identity +
// digest function as parameters so the same machinery serves multiple
// Planner implementations.

export interface PlanAssemblyDeps {
  computeDigest: (obj: unknown) => Sha256Hex;
  plannerType: NonEmpty;
  plannerVersion: NonEmpty;
  orchestratorActorId: Uuid;
}

// ─── DAG Acyclicity Check ───

export function hasCycle(nodes: PlanNode[], edges: PlanEdge[]): boolean {
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
    if (inStack.has(nodeId)) return true; // cycle
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

// ─── Edge Sort Comparator — §5.1 step 10 ───

export function compareEdges(a: PlanEdge, b: PlanEdge): number {
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

// ─── Rejection Helper ───

export function reject(
  reason: PlanRejectionReason,
  detail: string,
  alternatives: SuggestedAgent[] = []
): PlanRejection {
  return {
    rejected: true,
    reason,
    reasonDetail: detail as NonEmpty,
    suggestedAlternatives: alternatives,
  };
}

// ─── Per-kind PlanNode builder for sub-task plans ───
// Maps SubTaskDecl.kind → nodeType + requiresNvg/Nxs flags + per-node
// fields, keeping the kind-discrimination logic in one place.

export function buildNodeFromSubTask(
  st: SubTaskDecl,
  planOrderIndex: number,
  nodeId: Uuid
): PlanNode {
  let nodeType: PlanNode['nodeType'];
  let requiresNvg: boolean;
  let requiresNxs: boolean;
  let taskPrompt: NonEmpty | null = null;
  let actionTemplate: NxsActionTemplate | null = null;

  switch (st.kind) {
    case 'nvg':
      nodeType = 'nvg_dispatch';
      requiresNvg = true;
      requiresNxs = false;
      taskPrompt = st.taskPrompt;
      break;
    case 'nxs':
      nodeType = 'nxs_dispatch';
      requiresNvg = false;
      requiresNxs = true;
      actionTemplate = st.actionTemplate;
      break;
    case 'secure_handoff':
      nodeType = 'secure_agent_handoff';
      requiresNvg = false;
      requiresNxs = false;
      taskPrompt = st.taskPrompt;
      break;
  }

  return {
    nodeId,
    planOrderIndex,
    agentId: st.agentId,
    taskSummary: st.taskSummary,
    requiresNvg,
    requiresNxs,
    nodeType,
    declaredRiskHint: EVIDENCE_SENTINEL,
    expectedOutputSlots: st.expectedOutputSlots,
    timeoutMs: NODE_TIMEOUT_MS,
    subTaskKey: st.subTaskKey,
    taskPrompt,
    inputSlotReads: st.inputSlotReads,
    actionTemplate,
  };
}

// ─── Shared condition validator ───
// Used by both EdgeHint and SubTaskEdgeHint construction paths so the
// condition normalization law (§3.1, EdgeHint normalization) is one
// chunk of code, not two.

export function validateConditionSpec(
  edgeType: 'data_dependency' | 'conditional' | 'sequential',
  conditionSpec: { sourceField: NonEmpty; operator: string; value: unknown } | null
): (PlanCondition | null) | PlanRejection {
  // Non-conditional edge requires conditionSpec === null
  if (edgeType !== 'conditional') {
    if (conditionSpec !== null) {
      return reject(
        'malformed_request',
        `Non-conditional edge type '${edgeType}' must have null conditionSpec`
      );
    }
    return null;
  }

  // Conditional edge requires non-null conditionSpec
  if (conditionSpec === null) {
    return reject('malformed_request', 'Conditional edge requires non-null conditionSpec');
  }

  // Validate operator
  if (!VALID_OPERATORS.has(conditionSpec.operator)) {
    return reject(
      'malformed_request',
      `Invalid conditionSpec operator '${conditionSpec.operator}'`
    );
  }

  // Validate value type: must be string | number | boolean | null
  if (
    conditionSpec.value !== null &&
    typeof conditionSpec.value !== 'string' &&
    typeof conditionSpec.value !== 'number' &&
    typeof conditionSpec.value !== 'boolean'
  ) {
    return reject(
      'malformed_request',
      `conditionSpec.value must be string | number | boolean | null, got ${typeof conditionSpec.value}`
    );
  }

  return {
    conditionId: randomUUID() as Uuid,
    sourceField: conditionSpec.sourceField,
    operator: conditionSpec.operator as PlanConditionOperator,
    value: conditionSpec.value as string | number | boolean | null,
  };
}

// ─── Visibility check — catalog visibility only [blueprint-K §11.7.1] ───

export function isVisible(agent: AgentCapabilityEntry, ceiling: NonEmpty[]): boolean {
  if (ceiling.length === 0) return true;
  return agent.capabilities.some(cap => ceiling.includes(cap));
}

// ─── Suggest-not-deny — find alternative agents [§5.2] ───

export async function findAlternatives(
  capabilities: NonEmpty[],
  context: PlannerContext
): Promise<SuggestedAgent[]> {
  const alternatives: SuggestedAgent[] = [];
  const seen = new Set<string>();

  for (const capability of capabilities) {
    const candidates = await context.registry.findByCapability(capability);
    const visible = candidates.filter(a => a.enabled && isVisible(a, context.capabilityCeiling));
    for (const alt of visible) {
      if (!seen.has(alt.agentId)) {
        seen.add(alt.agentId);
        alternatives.push({
          agentId: alt.agentId as Uuid,
          capability,
          reason: `Agent has capability '${capability}'` as NonEmpty,
        });
      }
    }
  }

  return alternatives;
}

// ─── Build edges from EdgeHints ───

export function buildEdges(
  edgeHints: EdgeHint[],
  agentToNodeId: Map<string, string>
): PlanEdge[] | PlanRejection {
  if (edgeHints.length === 0) return [];

  const edges: PlanEdge[] = [];

  for (const hint of edgeHints) {
    const sourceNodeId = agentToNodeId.get(hint.sourceAgentId);
    const targetNodeId = agentToNodeId.get(hint.targetAgentId);

    if (!sourceNodeId) {
      return reject(
        'malformed_request',
        `EdgeHint references unknown sourceAgentId '${hint.sourceAgentId}'`
      );
    }
    if (!targetNodeId) {
      return reject(
        'malformed_request',
        `EdgeHint references unknown targetAgentId '${hint.targetAgentId}'`
      );
    }

    // Validate conditionSpec per EdgeHint normalization law
    const conditionResult = validateConditionSpec(hint.edgeType, hint.conditionSpec);
    if (conditionResult !== null && 'rejected' in conditionResult) {
      return conditionResult;
    }

    edges.push({
      edgeId: randomUUID() as Uuid,
      sourceNodeId: sourceNodeId as Uuid,
      targetNodeId: targetNodeId as Uuid,
      edgeType: hint.edgeType as PlanEdgeType,
      condition: conditionResult,
      outputSlotRef: hint.outputSlotRef,
    });
  }

  return edges;
}

// ─── Build final ExecutionPlan with digest ───

export function buildPlan(
  runId: Uuid,
  nodes: PlanNode[],
  edges: PlanEdge[],
  deps: PlanAssemblyDeps
): ExecutionPlan {
  const planId = randomUUID() as Uuid;
  const createdAt = nowIso();

  // §3.2: planDigest excludes createdAt
  const planDigest = deps.computeDigest({
    planId,
    runId,
    nodes: [...nodes].sort((a, b) => a.planOrderIndex - b.planOrderIndex),
    edges: [...edges].sort(compareEdges),
    plannerType: deps.plannerType,
    plannerVersion: deps.plannerVersion,
  });

  return {
    planId,
    runId,
    planDigest,
    nodes,
    edges,
    plannerType: deps.plannerType,
    plannerVersion: deps.plannerVersion,
    createdAt,
  };
}

// ─── Task summary builder ───

export function buildTaskSummary(
  _request: NormalPlannerRequest | MetadataPlannerRequest,
  agent: AgentCapabilityEntry
): NonEmpty {
  return `Task for agent ${agent.agentId}` as NonEmpty;
}

// ─── OCT-SECURE plan ───
// Single node for secureAgentId. No prompt. secure_agent_handoff.
// taskSummary = 'OCT_SECURE_REDACTED'. [§5.1 step 1]

export async function planOctSecure(
  request: OctSecurePlannerRequest,
  context: PlannerContext,
  deps: PlanAssemblyDeps
): Promise<ExecutionPlan | PlanRejection> {
  const agent = await context.registry.getById(request.secureAgentId);
  if (!agent) {
    return reject(
      'no_capable_agent',
      `Secure agent ${request.secureAgentId} not found in registry`
    );
  }

  const node: PlanNode = {
    nodeId: randomUUID() as Uuid,
    planOrderIndex: 0,
    agentId: request.secureAgentId,
    taskSummary: 'OCT_SECURE_REDACTED' as NonEmpty,
    requiresNvg: false,
    requiresNxs: false,
    nodeType: 'secure_agent_handoff',
    declaredRiskHint: EVIDENCE_SENTINEL,
    expectedOutputSlots: ['secure_output' as NonEmpty],
    timeoutMs: NODE_TIMEOUT_MS,
  };

  return buildPlan(request.runId, [node], [], deps);
}

// ─── Multi-node sub-task plan (AMEND-spec-nexus-orch §5 extension) ───
// Emits one node per SubTaskDecl with proper kind-driven nodeType and
// per-node fields wired through. selectedAgentIds /
// requiredCapabilities / edgeHints are NOT consulted on this branch.

export async function planFromSubTasks(
  request: NormalPlannerRequest | MetadataPlannerRequest,
  context: PlannerContext,
  deps: PlanAssemblyDeps
): Promise<ExecutionPlan | PlanRejection> {
  const subTasks = request.subTasks!;
  const subTaskEdges = request.subTaskEdges ?? [];

  // ── 1. subTaskKey uniqueness ──
  const seenKeys = new Set<string>();
  for (const st of subTasks) {
    if (seenKeys.has(st.subTaskKey)) {
      return reject('malformed_request', `Duplicate subTaskKey '${st.subTaskKey}'`);
    }
    seenKeys.add(st.subTaskKey);
  }

  // ── 2. inputSlotReads reference known sub-tasks + non-self ──
  for (const st of subTasks) {
    for (const ref of st.inputSlotReads) {
      if (!seenKeys.has(ref.fromSubTaskKey)) {
        return reject(
          'malformed_request',
          `subTask '${st.subTaskKey}' inputSlotReads references unknown subTaskKey '${ref.fromSubTaskKey}'`
        );
      }
      if (ref.fromSubTaskKey === st.subTaskKey) {
        return reject(
          'malformed_request',
          `subTask '${st.subTaskKey}' inputSlotReads cannot read from its own slot`
        );
      }
    }
  }

  // ── 3. nxs sub-tasks must carry an actionTemplate ──
  for (const st of subTasks) {
    if (st.kind === 'nxs') {
      if (!st.actionTemplate) {
        return reject(
          'malformed_request',
          `subTask '${st.subTaskKey}' is kind 'nxs' but missing actionTemplate`
        );
      }
    }
  }

  // ── 3b. slotBindings consistency — every nxs actionTemplate
  //        slot binding MUST also appear in the sub-task's
  //        inputSlotReads. Without this the audit trail at plan
  //        time disagrees with what orch reads at dispatch time. ──
  for (const st of subTasks) {
    if (st.kind !== 'nxs') continue;
    const bindings = st.actionTemplate?.slotBindings;
    if (!bindings || bindings.length === 0) continue;
    const readsByKeySlot = new Set(st.inputSlotReads.map(r => `${r.fromSubTaskKey}::${r.slotId}`));
    for (const b of bindings) {
      const key = `${b.fromSubTaskKey}::${b.slotId}`;
      if (!readsByKeySlot.has(key)) {
        return reject(
          'malformed_request',
          `subTask '${st.subTaskKey}' slotBinding (fromSubTaskKey='${b.fromSubTaskKey}', slotId='${b.slotId}') has no matching inputSlotReads entry`
        );
      }
    }
  }

  // ── 4. agent existence + visibility (per sub-task, NO dedup) ──
  for (const st of subTasks) {
    const agent = await context.registry.getById(st.agentId);
    if (!agent) {
      const alts = await findAlternatives([], context);
      return reject(
        'no_capable_agent',
        `Agent ${st.agentId} for subTask '${st.subTaskKey}' not found in registry`,
        alts
      );
    }
    if (!isVisible(agent, context.capabilityCeiling)) {
      const alts = await findAlternatives(agent.capabilities, context);
      return reject(
        'capability_outside_ceiling',
        `Agent ${st.agentId} for subTask '${st.subTaskKey}' is outside capability ceiling`,
        alts
      );
    }
    if (!agent.enabled) {
      const alts = await findAlternatives(agent.capabilities, context);
      return reject(
        'no_capable_agent',
        `Agent ${st.agentId} for subTask '${st.subTaskKey}' is disabled`,
        alts
      );
    }
  }

  // ── 5. maxSplitDepth on sub-task count (NOT distinct-agent count) ──
  if (subTasks.length > context.maxSplitDepth) {
    return reject(
      'max_split_exceeded',
      `Plan requires ${subTasks.length} sub-tasks but maxSplitDepth is ${context.maxSplitDepth}`
    );
  }

  // ── 6. Construct PlanNodes per sub-task ──
  const subTaskKeyToNodeId = new Map<string, string>();
  const nodes: PlanNode[] = subTasks.map((st, index) => {
    const nodeId = randomUUID() as Uuid;
    subTaskKeyToNodeId.set(st.subTaskKey, nodeId);
    return buildNodeFromSubTask(st, index, nodeId);
  });

  // ── 7. Build edges from subTaskEdges (keyed by subTaskKey) ──
  const edges: PlanEdge[] = [];
  for (const hint of subTaskEdges) {
    const sourceNodeId = subTaskKeyToNodeId.get(hint.sourceSubTaskKey);
    const targetNodeId = subTaskKeyToNodeId.get(hint.targetSubTaskKey);
    if (!sourceNodeId) {
      return reject(
        'malformed_request',
        `subTaskEdge references unknown sourceSubTaskKey '${hint.sourceSubTaskKey}'`
      );
    }
    if (!targetNodeId) {
      return reject(
        'malformed_request',
        `subTaskEdge references unknown targetSubTaskKey '${hint.targetSubTaskKey}'`
      );
    }

    const conditionResult = validateConditionSpec(hint.edgeType, hint.conditionSpec);
    if (conditionResult !== null && 'rejected' in conditionResult) {
      return conditionResult;
    }

    edges.push({
      edgeId: randomUUID() as Uuid,
      sourceNodeId: sourceNodeId as Uuid,
      targetNodeId: targetNodeId as Uuid,
      edgeType: hint.edgeType as PlanEdgeType,
      condition: conditionResult,
      outputSlotRef: hint.outputSlotRef,
    });
  }

  // ── 8. DAG acyclicity ──
  if (edges.length > 0 && hasCycle(nodes, edges)) {
    return reject('malformed_request', 'subTaskEdges form a cycle — DAG required');
  }

  // ── 9. Sort + build ──
  edges.sort(compareEdges);
  return buildPlan(request.runId, nodes, edges, deps);
}

// ─── Standard plan (normal / metadata) — legacy selectedAgentIds path ───

export async function planStandard(
  request: NormalPlannerRequest | MetadataPlannerRequest,
  context: PlannerContext,
  deps: PlanAssemblyDeps
): Promise<ExecutionPlan | PlanRejection> {
  // §5.1 step 3: both empty → reject
  if (request.selectedAgentIds.length === 0 && request.requiredCapabilities.length === 0) {
    return reject('malformed_request', 'V1 requires explicit agent selection or capabilities');
  }

  // Resolve agents
  const resolvedAgents: AgentCapabilityEntry[] = [];

  if (request.selectedAgentIds.length > 0) {
    // §5.1 step 2: validate selectedAgentIds
    for (const agentId of request.selectedAgentIds) {
      const agent = await context.registry.getById(agentId);

      if (!agent) {
        // Suggest-not-deny [§5.2]
        const alternatives = await findAlternatives(request.requiredCapabilities, context);
        return reject('no_capable_agent', `Agent ${agentId} not found in registry`, alternatives);
      }

      // Check visibility under capabilityCeiling [§5.2]
      if (!isVisible(agent, context.capabilityCeiling)) {
        const alternatives = await findAlternatives(agent.capabilities, context);
        return reject(
          'capability_outside_ceiling',
          `Agent ${agentId} is outside capability ceiling`,
          alternatives
        );
      }

      if (!agent.enabled) {
        const alternatives = await findAlternatives(agent.capabilities, context);
        return reject('no_capable_agent', `Agent ${agentId} is disabled`, alternatives);
      }

      resolvedAgents.push(agent);
    }
  } else {
    // Find agents by requiredCapabilities
    const seenAgentIds = new Set<string>();
    for (const capability of request.requiredCapabilities) {
      const candidates = await context.registry.findByCapability(capability);
      const visible = candidates.filter(a => a.enabled && isVisible(a, context.capabilityCeiling));

      if (visible.length === 0) {
        const allAlts = await findAlternatives([capability], context);
        return reject(
          'no_capable_agent',
          `No enabled agent found for capability '${capability}'`,
          allAlts
        );
      }

      // Take first visible agent not already in the plan
      const chosen = visible.find(a => !seenAgentIds.has(a.agentId)) ?? visible[0];
      if (!chosen) {
        const allAlts = await findAlternatives([capability], context);
        return reject(
          'no_capable_agent',
          `No enabled agent found for capability '${capability}'`,
          allAlts
        );
      }

      if (!seenAgentIds.has(chosen.agentId)) {
        seenAgentIds.add(chosen.agentId);
        resolvedAgents.push(chosen);
      }
    }
  }

  // §5.1 step 9: validate maxSplitDepth
  if (resolvedAgents.length > context.maxSplitDepth) {
    return reject(
      'max_split_exceeded',
      `Plan requires ${resolvedAgents.length} nodes but maxSplitDepth is ${context.maxSplitDepth}`
    );
  }

  // §5.1 step 4: create PlanNodes with sequential planOrderIndex.
  //
  // Legacy single-prompt path: every node is an LLM dispatch — the
  // composition root invokes NVG, the model may emit tool_calls, and
  // the round-trip loop drives any NXS work through gates. Despite
  // the historical naming, the runtime semantics here are
  // `nvg_dispatch`, not `nxs_dispatch`. Aligning the nodeType with
  // the actual dispatch path now that P3 branches on it.
  const agentToNodeId = new Map<string, string>();
  const nodes: PlanNode[] = resolvedAgents.map((agent, index) => {
    const nodeId = randomUUID() as Uuid;
    agentToNodeId.set(agent.agentId, nodeId);
    return {
      nodeId,
      planOrderIndex: index,
      agentId: agent.agentId as Uuid,
      taskSummary: buildTaskSummary(request, agent),
      requiresNvg: true,
      requiresNxs: false,
      nodeType: 'nvg_dispatch' as const,
      declaredRiskHint: EVIDENCE_SENTINEL,
      expectedOutputSlots: ['default' as NonEmpty],
      timeoutMs: NODE_TIMEOUT_MS,
    };
  });

  // §5.1 step 7: build edges from edgeHints [OD-ORCH-02]
  const edgesResult = buildEdges(request.edgeHints, agentToNodeId);
  if ('rejected' in edgesResult) {
    return edgesResult;
  }
  const edges = edgesResult;

  // §5.1 step 8: validate DAG acyclicity
  if (edges.length > 0 && hasCycle(nodes, edges)) {
    return reject('malformed_request', 'Edge hints form a cycle — DAG required');
  }

  // §5.1 step 10: sort (nodes already sorted by planOrderIndex from construction)
  edges.sort(compareEdges);

  return buildPlan(request.runId, nodes, edges, deps);
}
