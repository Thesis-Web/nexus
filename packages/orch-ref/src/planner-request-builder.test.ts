// packages/orch-ref/src/planner-request-builder.test.ts
//
// AMEND-nexus-planner-chat-tier-v0-2-0.md §9.3 (integration) — server-side
// tier derivation unit tests. The full coordinator integration is covered
// downstream; these tests pin the discriminator-by-entryMode behavior so
// the chat path is wired before any HTTP request hits.

import { describe, expect, it } from 'vitest';
import type {
  IsoTimestamp,
  NonEmpty,
  Sha256Hex,
  Uuid,
  WorkspaceManifestRecord,
  WorkspaceRunRequest,
} from '@nexus/contracts';
import { buildPlannerRequestForWorkspace } from './planner-request-builder.js';

const RUN_ID = '00000000-0000-4000-8000-000000000001' as Uuid;
const PRINCIPAL = '00000000-0000-4000-8000-000000000010' as Uuid;
const CHAT_AGENT = '00000000-0000-4000-8000-0000000000c1' as Uuid;
const WAREHOUSE_AGENT = '00000000-0000-4000-8000-0000000000a1' as Uuid;

const FROZEN_TIME = '2026-05-15T00:00:00.000Z' as IsoTimestamp;
const nowFrozen = (): IsoTimestamp => FROZEN_TIME;

function baseRunRequest(overrides: Partial<WorkspaceRunRequest> = {}): WorkspaceRunRequest {
  return {
    runId: RUN_ID,
    userId: 'james@lakearea.test' as NonEmpty,
    principalId: PRINCIPAL,
    authenticatedBy: 'local' as NonEmpty,
    enteredAt: FROZEN_TIME,
    prompt: 'Who are you?' as NonEmpty,
    promptDigest: 'a'.repeat(64) as Sha256Hex,
    promptRef: null,
    selectedAgentIds: [],
    workspaceSocketId: 'nexus-chat-default' as NonEmpty,
    planCheckbackRequested: false,
    preferredEndpointId: null,
    attachedFiles: [],
    subTasks: null,
    subTaskEdges: null,
    checkbackSourceRunId: null,
    ...overrides,
  };
}

const CHAT_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'nexus-chat-default' as NonEmpty,
  workspaceType: 'chat_workspace' as NonEmpty,
  enabled: true,
  entryMode: 'free_chat',
  baseUrl: 'http://localhost:7780/chat' as NonEmpty,
  returnEndpointId: 'nexus-default-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: false, finalDisplay: true, fileSpace: false },
  configuration: { defaultChatAgentId: CHAT_AGENT },
};

const GOVERNED_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'nexus-warehouse-ops' as NonEmpty,
  workspaceType: 'reference_http' as NonEmpty,
  enabled: true,
  entryMode: 'governed_only',
  baseUrl: 'http://localhost:7780/workspace' as NonEmpty,
  returnEndpointId: 'nexus-default-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: true, finalDisplay: true, fileSpace: false },
  configuration: {},
};

describe('buildPlannerRequestForWorkspace — tier derivation', () => {
  it("derives tier 'chat' when workspace.entryMode === 'free_chat'", () => {
    const result = buildPlannerRequestForWorkspace({
      request: baseRunRequest({ selectedAgentIds: [CHAT_AGENT] }),
      workspace: CHAT_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(result.tier).toBe('chat');
    if (result.tier !== 'chat') throw new Error('narrow failed');
    expect(result.selectedAgentIds).toHaveLength(1);
    expect(result.selectedAgentIds[0]).toBe(CHAT_AGENT);
    expect(result.prompt).toBe('Who are you?');
    expect(result.workspaceSocketId).toBe('nexus-chat-default');
  });

  it("derives tier 'normal' when workspace.entryMode === 'governed_only'", () => {
    const result = buildPlannerRequestForWorkspace({
      request: baseRunRequest({
        workspaceSocketId: 'nexus-warehouse-ops' as NonEmpty,
        prompt: 'pull the warehouse inventory' as NonEmpty,
        selectedAgentIds: [WAREHOUSE_AGENT],
      }),
      workspace: GOVERNED_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(result.tier).toBe('normal');
    if (result.tier !== 'normal') throw new Error('narrow failed');
    expect(result.selectedAgentIds).toEqual([WAREHOUSE_AGENT]);
    expect(result.prompt).toBe('pull the warehouse inventory');
    expect(result.subTasks).toBeNull();
  });

  it('falls back to governed_only behavior when workspace is undefined (legacy single-workspace)', () => {
    const result = buildPlannerRequestForWorkspace({
      request: baseRunRequest({ selectedAgentIds: [WAREHOUSE_AGENT] }),
      workspace: undefined,
      nowIso: nowFrozen,
    });
    expect(result.tier).toBe('normal');
  });

  it('server override: stale UI tier value is ignored — workspace.entryMode is the signed source of truth', () => {
    // Simulating a UI that posted a request intending governed flow, but
    // the workspace is configured as free_chat. The builder ignores any
    // client-supplied tier; workspace.entryMode wins.
    const result = buildPlannerRequestForWorkspace({
      request: baseRunRequest({
        workspaceSocketId: 'nexus-chat-default' as NonEmpty,
        selectedAgentIds: [CHAT_AGENT],
        subTasks: [], // UI tried to post a sub-task DAG; chat ignores
      }),
      workspace: CHAT_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(result.tier).toBe('chat');
  });

  it('propagates preferredEndpointId for both tiers', () => {
    const chatResult = buildPlannerRequestForWorkspace({
      request: baseRunRequest({
        selectedAgentIds: [CHAT_AGENT],
        preferredEndpointId: 'ollama-jameshp' as NonEmpty,
      }),
      workspace: CHAT_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(chatResult.tier).toBe('chat');
    if (chatResult.tier !== 'chat') throw new Error('narrow failed');
    expect(chatResult.preferredEndpointId).toBe('ollama-jameshp');

    const govResult = buildPlannerRequestForWorkspace({
      request: baseRunRequest({
        workspaceSocketId: 'nexus-warehouse-ops' as NonEmpty,
        selectedAgentIds: [WAREHOUSE_AGENT],
        preferredEndpointId: 'ollama-jameshp' as NonEmpty,
      }),
      workspace: GOVERNED_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(govResult.tier).toBe('normal');
    if (govResult.tier !== 'normal') throw new Error('narrow failed');
    expect(govResult.preferredEndpointId).toBe('ollama-jameshp');
  });

  it('propagates checkbackSourceRunId for chat tier (symmetric Branch 3 reissue)', () => {
    const SOURCE = '00000000-0000-4000-8000-000000000099' as Uuid;
    const result = buildPlannerRequestForWorkspace({
      request: baseRunRequest({
        selectedAgentIds: [CHAT_AGENT],
        checkbackSourceRunId: SOURCE,
      }),
      workspace: CHAT_WORKSPACE,
      nowIso: nowFrozen,
    });
    expect(result.tier).toBe('chat');
    if (result.tier !== 'chat') throw new Error('narrow failed');
    expect(result.checkbackSourceRunId).toBe(SOURCE);
  });
});
