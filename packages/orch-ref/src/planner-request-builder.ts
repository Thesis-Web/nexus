// packages/orch-ref/src/planner-request-builder.ts
//
// AMEND-nexus-planner-chat-tier-v0-2-0.md §3.6 — server-side tier
// derivation. The PlannerRequest the planner sees has its tier value
// derived from the resolved workspace's `entryMode`, NOT from any
// client-supplied value. The workspace manifest is the signed source of
// truth; the UI's posted tier is advisory only.
//
// `entryMode: 'free_chat'` → ChatPlannerRequest (tier 'chat')
// `entryMode: 'governed_only'` → NormalPlannerRequest (tier 'normal')
// missing workspace (lookup miss) → governed_only fallback so legacy
//   single-workspace deployments behave unchanged
//
// This module is pure — no I/O, no clock side-effects beyond the
// injected `nowIso` function — so the derivation is unit-testable in
// isolation.

import type {
  ChatPlannerRequest,
  IsoTimestamp,
  NonEmpty,
  NormalPlannerRequest,
  PlannerRequest,
  Uuid,
  WorkspaceManifestRecord,
  WorkspaceRunRequest,
} from '@nexus/contracts';

export interface BuildPlannerRequestArgs {
  request: WorkspaceRunRequest;
  /**
   * The workspace record matching `request.workspaceSocketId`. When
   * undefined (legacy deployments that don't pass the workspaceSockets
   * array, or a stale workspaceSocketId), the builder falls back to
   * governed_only behavior.
   */
  workspace?: WorkspaceManifestRecord | undefined;
  /** Injected clock for deterministic tests. */
  nowIso: () => IsoTimestamp;
}

export function buildPlannerRequestForWorkspace(args: BuildPlannerRequestArgs): PlannerRequest {
  const { request, workspace, nowIso } = args;

  if (workspace?.entryMode === 'free_chat') {
    return buildChatPlannerRequestFromRun(request, nowIso);
  }
  return buildNormalPlannerRequestFromRun(request, nowIso);
}

// Server-side cardinality validation belongs at the route, not here, so
// the route can reject with HTTP 400 before any ledger writes. This
// builder still narrows the tuple type for the planner — callers that
// bypass the route get a runtime malformed-request from planChatBranch.
function buildChatPlannerRequestFromRun(
  request: WorkspaceRunRequest,
  nowIso: () => IsoTimestamp
): ChatPlannerRequest {
  const agentId =
    (request.selectedAgentIds[0] as Uuid | undefined) ??
    ('00000000-0000-0000-0000-000000000000' as Uuid);

  return {
    tier: 'chat',
    runId: request.runId,
    userId: request.userId,
    principalId: request.principalId,
    workspaceSocketId: request.workspaceSocketId,
    prompt: request.prompt,
    selectedAgentIds: [agentId] as readonly [Uuid],
    preferredEndpointId: request.preferredEndpointId,
    checkbackSourceRunId: request.checkbackSourceRunId,
    enteredAt: nowIso(),
  };
}

function buildNormalPlannerRequestFromRun(
  request: WorkspaceRunRequest,
  nowIso: () => IsoTimestamp
): NormalPlannerRequest {
  return {
    tier: 'normal',
    runId: request.runId,
    userId: request.userId,
    principalId: request.principalId,
    prompt: request.prompt,
    selectedAgentIds: request.selectedAgentIds,
    requiredCapabilities: [] as NonEmpty[],
    edgeHints: [],
    workspaceSocketId: request.workspaceSocketId,
    planCheckbackRequested: request.planCheckbackRequested,
    enteredAt: nowIso(),
    preferredEndpointId: request.preferredEndpointId,
    subTasks: request.subTasks ?? null,
    subTaskEdges: request.subTaskEdges ?? null,
  };
}
