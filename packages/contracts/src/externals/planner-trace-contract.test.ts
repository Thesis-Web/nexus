// packages/contracts/src/externals/planner-trace-contract.test.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 3 — contract
// surface for `PlannerPlanTrace`, `PlannerTraceReader`, and the
// additive `OrchestratorPlanPreview.rejection` /
// `WorkspaceRunRequest.checkbackSourceRunId` / `RejectionCheckbackPayload`
// types. Compile-time shape tests; type errors here are spec violations
// before any planner code is written.

import { describe, expect, it } from 'vitest';
import type {
  IsoTimestamp,
  NonEmpty,
  OrchestratorPlanPreview,
  PlannerPlanTrace,
  PlannerTraceReader,
  RejectionCheckbackPayload,
  RunEventType,
  Sha256Hex,
  SuggestedAgent,
  Uuid,
  WorkspaceRunRequest,
} from '../index.js';

const RUN_ID = '00000000-0000-4000-8000-000000000001' as Uuid;
const AGENT_A = '00000000-0000-4000-8000-0000000000a1' as Uuid;
const AGENT_B = '00000000-0000-4000-8000-0000000000b1' as Uuid;

describe('PlannerPlanTrace contract shape', () => {
  it('accepts a successful lexical_decomposition trace', () => {
    const trace: PlannerPlanTrace = {
      runId: RUN_ID,
      plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
      plannerVersion: '0.1.0' as NonEmpty,
      promptDigest: 'a'.repeat(64) as Sha256Hex,
      branch: 'lexical_decomposition',
      operatorPreference: null,
      preflightOutcome: 'not_applicable',
      lexicalMatches: [
        {
          rawTerm: 'pull',
          canonicalTerm: 'read',
          phraseClass: 'verb',
          aliasRule: 'approved',
        },
      ],
      candidateIntents: ['inventory.adjust_from_receiving' as NonEmpty],
      selectedIntent: 'inventory.adjust_from_receiving' as NonEmpty,
      candidateTemplates: ['workflow_inventory_adjust_from_receiving_v1' as NonEmpty],
      selectedTemplate: 'workflow_inventory_adjust_from_receiving_v1' as NonEmpty,
      requiredCapabilities: [
        'read:record:single' as NonEmpty,
        'update:record:internal' as NonEmpty,
      ],
      candidateAgents: [{ capability: 'read:record:single' as NonEmpty, agentIds: [AGENT_A] }],
      planOutcome: 'plan_created',
      rejectionReason: null,
      rejectionDetail: null,
      emittedAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
    };
    expect(trace.branch).toBe('lexical_decomposition');
    expect(trace.planOutcome).toBe('plan_created');
  });

  it('accepts an oct_secure trace with null promptDigest', () => {
    const trace: PlannerPlanTrace = {
      runId: RUN_ID,
      plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
      plannerVersion: '0.1.0' as NonEmpty,
      promptDigest: null, // oct_secure tier carries no prompt
      branch: 'oct_secure',
      operatorPreference: null,
      preflightOutcome: null,
      lexicalMatches: [],
      candidateIntents: [],
      selectedIntent: null,
      candidateTemplates: [],
      selectedTemplate: null,
      requiredCapabilities: [],
      candidateAgents: [],
      planOutcome: 'plan_created',
      rejectionReason: null,
      rejectionDetail: null,
      emittedAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
    };
    expect(trace.promptDigest).toBeNull();
    expect(trace.branch).toBe('oct_secure');
  });

  it('accepts a preflight-reject trace with richer planOutcome than contract enum', () => {
    // Two-enum distinction (DIFF-PLANNER-LEXICON-001): the ledger event
    // owns its own enum, which CAN carry a richer distinction than
    // PlanRejectionReason. Here, planOutcome captures the ambiguous
    // signal even though the contract-level rejection would collapse to
    // 'unmappable_request'.
    const trace: PlannerPlanTrace = {
      runId: RUN_ID,
      plannerType: 'db-lexicon-transformer-v0' as NonEmpty,
      plannerVersion: '0.1.0' as NonEmpty,
      promptDigest: 'b'.repeat(64) as Sha256Hex,
      branch: 'preflight_preferred_agents',
      operatorPreference: { selectedAgentIds: [AGENT_A], preferredEndpointId: null },
      preflightOutcome: 'preferred_agents_insufficient_alternatives_suggested',
      lexicalMatches: [],
      candidateIntents: [],
      selectedIntent: null,
      candidateTemplates: [],
      selectedTemplate: null,
      requiredCapabilities: ['update:record:internal' as NonEmpty],
      candidateAgents: [{ capability: 'update:record:internal' as NonEmpty, agentIds: [AGENT_B] }],
      planOutcome: 'plan_rejected_no_capable_agent',
      rejectionReason: 'no_capable_agent',
      rejectionDetail:
        'preflight_preferred_agents_insufficient: update:record:internal' as NonEmpty,
      emittedAt: '2026-05-13T00:00:00.000Z' as IsoTimestamp,
    };
    expect(trace.preflightOutcome).toBe('preferred_agents_insufficient_alternatives_suggested');
    expect(trace.rejectionReason).toBe('no_capable_agent');
  });
});

describe('RejectionCheckbackPayload contract shape', () => {
  it('carries the executable replacement set + per-capability display detail', () => {
    const suggestion: SuggestedAgent = {
      agentId: AGENT_B,
      capability: 'update:record:internal' as NonEmpty,
      reason: 'warehouse-agent has update:record:internal' as NonEmpty,
    };

    const payload: RejectionCheckbackPayload = {
      reason: 'no_capable_agent',
      reasonDetail: 'preflight_preferred_agents_insufficient: update:record:internal' as NonEmpty,
      missingCapabilities: ['update:record:internal' as NonEmpty],
      rejectedSelectedAgentIds: [AGENT_A],
      recommendedSelectedAgentIds: [AGENT_B],
      alternativesByCapability: {
        'update:record:internal': [suggestion],
      },
    };

    // The executable replacement set must cover every missing capability —
    // contract law per spec §3.7. Asserting structurally:
    expect(payload.recommendedSelectedAgentIds.length).toBeGreaterThan(0);
    expect(payload.alternativesByCapability['update:record:internal']).toContain(suggestion);
  });
});

describe('OrchestratorPlanPreview.rejection field', () => {
  it('accepts null on success paths', () => {
    const preview: OrchestratorPlanPreview = {
      runId: RUN_ID,
      orchestratorSocketId: 'ref' as NonEmpty,
      orchestratorActorId: AGENT_A,
      plannerMode: 'deterministic',
      selectedAgents: [],
      requiresUserApproval: false,
      planDigest: 'c'.repeat(64) as Sha256Hex,
      plan: null,
      rejection: null,
    };
    expect(preview.rejection).toBeNull();
  });

  it('accepts a populated RejectionCheckbackPayload on rejection paths', () => {
    const payload: RejectionCheckbackPayload = {
      reason: 'no_capable_agent',
      reasonDetail: 'preflight_preferred_agents_insufficient' as NonEmpty,
      missingCapabilities: ['update:record:internal' as NonEmpty],
      rejectedSelectedAgentIds: [AGENT_A],
      recommendedSelectedAgentIds: [AGENT_B],
      alternativesByCapability: {},
    };
    const preview: OrchestratorPlanPreview = {
      runId: RUN_ID,
      orchestratorSocketId: 'ref' as NonEmpty,
      orchestratorActorId: AGENT_A,
      plannerMode: 'deterministic',
      selectedAgents: [],
      requiresUserApproval: false,
      planDigest: '' as Sha256Hex,
      plan: null,
      rejection: payload,
    };
    expect(preview.rejection?.recommendedSelectedAgentIds).toEqual([AGENT_B]);
  });
});

describe('WorkspaceRunRequest.checkbackSourceRunId field', () => {
  it('accepts null on fresh runs', () => {
    // Use Pick to spotlight just the new field — we don't need to
    // construct a full WorkspaceRunRequest for the shape assertion.
    const fragment: Pick<WorkspaceRunRequest, 'runId' | 'checkbackSourceRunId'> = {
      runId: RUN_ID,
      checkbackSourceRunId: null,
    };
    expect(fragment.checkbackSourceRunId).toBeNull();
  });

  it('accepts the originally-rejected runId on re-issue', () => {
    const SOURCE_RUN = '00000000-0000-4000-8000-000000000099' as Uuid;
    const fragment: Pick<WorkspaceRunRequest, 'runId' | 'checkbackSourceRunId'> = {
      runId: RUN_ID,
      checkbackSourceRunId: SOURCE_RUN,
    };
    expect(fragment.checkbackSourceRunId).toBe(SOURCE_RUN);
  });
});

describe('PlannerTraceReader interface', () => {
  it('coordinator can duck-type check for getLastTrace', () => {
    class TracingPlanner implements PlannerTraceReader {
      private lastTrace: PlannerPlanTrace | null = null;
      setTrace(trace: PlannerPlanTrace): void {
        this.lastTrace = trace;
      }
      getLastTrace(): PlannerPlanTrace | null {
        return this.lastTrace;
      }
    }

    const planner = new TracingPlanner();

    // Duck-type detection matches the pattern the coordinator uses
    // in Commit 5 after planner.plan() returns.
    expect('getLastTrace' in planner).toBe(true);
    expect(typeof planner.getLastTrace).toBe('function');
    expect(planner.getLastTrace()).toBeNull();
  });

  it('non-tracing planner correctly fails duck-type check', () => {
    class LegacyPlanner {
      // Intentionally does NOT implement PlannerTraceReader.
      readonly id = 'legacy';
    }

    const planner = new LegacyPlanner();
    expect('getLastTrace' in planner).toBe(false);
  });
});

describe('RunEventType union — planner_plan_trace', () => {
  it("accepts the new 'planner_plan_trace' literal", () => {
    const eventType: RunEventType = 'planner_plan_trace';
    expect(eventType).toBe('planner_plan_trace');
  });

  it('still accepts existing planner-related event types', () => {
    // HL#4 canonical names — legacy `plan_rejected` was removed from
    // RunEventType 2026-05-23 (fix-spec post-consolidation).
    const created: RunEventType = 'plan_created';
    const infeasible: RunEventType = 'planner_infeasible';
    const checkback: RunEventType = 'plan_checkback_sent';
    expect([created, infeasible, checkback]).toHaveLength(3);
  });
});
