// packages/contracts/src/externals/chat-tier-contract.test.ts
// AMEND-nexus-planner-chat-tier-v0-2-0.md §6.1 Commit 1 — contract
// surface for `ChatPlannerRequest`, the widened `PromptVisibilityTier`,
// the widened `PlannerRequest` union, the widened
// `WorkspaceManifestRecord.entryMode`, and the widened
// `PlannerPlanTrace.branch` enum. Compile-time shape tests; type errors
// here are spec violations before any planner code is written.
// Logs ADD-CHAT-TIER-001, ADD-CHAT-TIER-002, ADD-CHAT-TIER-003.

import { describe, expect, it } from 'vitest';
import type {
  ChatPlannerRequest,
  IsoTimestamp,
  NonEmpty,
  PlannerPlanTrace,
  PlannerRequest,
  PromptVisibilityTier,
  Sha256Hex,
  Uuid,
  WorkspaceManifestRecord,
} from '../index.js';

const RUN_ID = '00000000-0000-4000-8000-000000000001' as Uuid;
const PRINCIPAL_ID = '00000000-0000-4000-8000-000000000010' as Uuid;
const CHAT_AGENT = '00000000-0000-4000-8000-0000000000c1' as Uuid;

describe('PromptVisibilityTier — chat widening (ADD-CHAT-TIER-001)', () => {
  it("accepts the new 'chat' literal", () => {
    const tier: PromptVisibilityTier = 'chat';
    expect(tier).toBe('chat');
  });

  it('still accepts the four pre-existing tier values', () => {
    const normal: PromptVisibilityTier = 'normal';
    const metadata: PromptVisibilityTier = 'metadata';
    const octSecure: PromptVisibilityTier = 'oct_secure';
    const chat: PromptVisibilityTier = 'chat';
    expect([normal, metadata, octSecure, chat]).toHaveLength(4);
  });
});

describe('ChatPlannerRequest contract shape (ADD-CHAT-TIER-002)', () => {
  it('accepts the minimal valid request', () => {
    const request: ChatPlannerRequest = {
      tier: 'chat',
      runId: RUN_ID,
      userId: 'james@lakearea.test' as NonEmpty,
      principalId: PRINCIPAL_ID,
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      prompt: 'Who are you?' as NonEmpty,
      selectedAgentIds: [CHAT_AGENT],
      preferredEndpointId: null,
      checkbackSourceRunId: null,
      enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    expect(request.tier).toBe('chat');
    expect(request.selectedAgentIds).toHaveLength(1);
    expect(request.selectedAgentIds[0]).toBe(CHAT_AGENT);
  });

  it('accepts preferredEndpointId carry-through (traced, not adjudicated)', () => {
    const request: ChatPlannerRequest = {
      tier: 'chat',
      runId: RUN_ID,
      userId: 'james@lakearea.test' as NonEmpty,
      principalId: PRINCIPAL_ID,
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      prompt: 'Hello' as NonEmpty,
      selectedAgentIds: [CHAT_AGENT],
      preferredEndpointId: 'ollama-jameshp' as NonEmpty,
      checkbackSourceRunId: null,
      enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    expect(request.preferredEndpointId).toBe('ollama-jameshp');
  });

  it('accepts checkbackSourceRunId for re-issue after symmetric checkback', () => {
    const SOURCE_RUN = '00000000-0000-4000-8000-000000000099' as Uuid;
    const request: ChatPlannerRequest = {
      tier: 'chat',
      runId: RUN_ID,
      userId: 'james@lakearea.test' as NonEmpty,
      principalId: PRINCIPAL_ID,
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      prompt: 'Hello' as NonEmpty,
      selectedAgentIds: [CHAT_AGENT],
      preferredEndpointId: null,
      checkbackSourceRunId: SOURCE_RUN,
      enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    expect(request.checkbackSourceRunId).toBe(SOURCE_RUN);
  });

  it('is assignable to PlannerRequest union', () => {
    const request: ChatPlannerRequest = {
      tier: 'chat',
      runId: RUN_ID,
      userId: 'james@lakearea.test' as NonEmpty,
      principalId: PRINCIPAL_ID,
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      prompt: 'Hello' as NonEmpty,
      selectedAgentIds: [CHAT_AGENT],
      preferredEndpointId: null,
      checkbackSourceRunId: null,
      enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    const widened: PlannerRequest = request;
    expect(widened.tier).toBe('chat');
  });
});

describe('PlannerRequest union — chat is discriminable (ADD-CHAT-TIER-002)', () => {
  it('discriminates chat from normal via tier literal', () => {
    const chatRequest: ChatPlannerRequest = {
      tier: 'chat',
      runId: RUN_ID,
      userId: 'james@lakearea.test' as NonEmpty,
      principalId: PRINCIPAL_ID,
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      prompt: 'Hello' as NonEmpty,
      selectedAgentIds: [CHAT_AGENT],
      preferredEndpointId: null,
      checkbackSourceRunId: null,
      enteredAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    const widened: PlannerRequest = chatRequest;

    // Type-narrowing pattern the planner dispatch uses
    if (widened.tier === 'chat') {
      expect(widened.prompt).toBe('Hello');
      expect(widened.selectedAgentIds).toHaveLength(1);
    } else {
      throw new Error('discriminator failed — chat request not narrowed');
    }
  });
});

describe('WorkspaceManifestRecord.entryMode — free_chat widening (ADD-CHAT-TIER-003)', () => {
  it("accepts the new 'free_chat' literal", () => {
    const record: WorkspaceManifestRecord = {
      workspaceSocketId: 'nexus-chat-default' as NonEmpty,
      workspaceType: 'chat_workspace' as NonEmpty,
      enabled: true,
      entryMode: 'free_chat',
      baseUrl: 'http://localhost:7780/chat' as NonEmpty,
      returnEndpointId: 'nexus-default-return' as NonEmpty,
      capabilities: {
        promptEntry: true,
        planReview: false,
        finalDisplay: true,
        fileSpace: false,
      },
      configuration: { defaultChatAgentId: CHAT_AGENT },
    };
    expect(record.entryMode).toBe('free_chat');
  });

  it("still accepts the pre-existing 'governed_only' literal", () => {
    const record: WorkspaceManifestRecord = {
      workspaceSocketId: 'nexus-warehouse-ops' as NonEmpty,
      workspaceType: 'http' as NonEmpty,
      enabled: true,
      entryMode: 'governed_only',
      baseUrl: 'http://localhost:7780/workspace' as NonEmpty,
      returnEndpointId: 'nexus-default-return' as NonEmpty,
      capabilities: {
        promptEntry: true,
        planReview: true,
        finalDisplay: true,
        fileSpace: false,
      },
      configuration: {},
    };
    expect(record.entryMode).toBe('governed_only');
  });
});

describe("PlannerPlanTrace.branch — 'chat' widening (ADD-CHAT-TIER-002)", () => {
  it("accepts the new 'chat' branch literal", () => {
    const trace: PlannerPlanTrace = {
      runId: RUN_ID,
      plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
      plannerVersion: '0.1.0' as NonEmpty,
      promptDigest: 'a'.repeat(64) as Sha256Hex,
      branch: 'chat',
      operatorPreference: { selectedAgentIds: [CHAT_AGENT], preferredEndpointId: null },
      preflightOutcome: 'preferred_agents_satisfy',
      lexicalMatches: [],
      candidateIntents: [],
      selectedIntent: null,
      candidateTemplates: [],
      selectedTemplate: null,
      requiredCapabilities: ['synthesize:content' as NonEmpty],
      candidateAgents: [{ capability: 'synthesize:content' as NonEmpty, agentIds: [CHAT_AGENT] }],
      planOutcome: 'plan_created',
      rejectionReason: null,
      rejectionDetail: null,
      emittedAt: '2026-05-15T00:00:00.000Z' as IsoTimestamp,
    };
    expect(trace.branch).toBe('chat');
    expect(trace.preflightOutcome).toBe('preferred_agents_satisfy');
  });

  it('still accepts the four pre-existing branch literals', () => {
    const branches: PlannerPlanTrace['branch'][] = [
      'oct_secure',
      'pre_resolved_sub_tasks',
      'preflight_preferred_agents',
      'lexical_decomposition',
      'chat',
    ];
    expect(branches).toHaveLength(5);
  });
});
