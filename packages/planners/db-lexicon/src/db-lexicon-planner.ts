// packages/planners/db-lexicon/src/db-lexicon-planner.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.1, §3.2, §3.3, §3.6, log
// ADD-PLANNER-LEXICON-002, BEST-PLANNER-LEXICON-001.
//
// The DbLexiconTransformerPlanner implements:
//   - `Planner`              — contract return type unchanged
//     (`Promise<ExecutionPlan | PlanRejection>`)
//   - `PlannerTraceReader`   — coordinator reads `getLastTrace()` after
//     each `plan()` call and emits `planner_plan_trace` ledger event
//   - `getLastRejectionCheckback()` — package-local duck-type method
//     that the coordinator reads after `plan()` returns a rejection
//     with usable alternatives; attached to
//     `OrchestratorPlanPreview.rejection`
//
// Four-branch tier dispatch (§3.3):
//   - Branch 1: `oct_secure` tier   — single-node secure_handoff
//   - Branch 2: pre-resolved subTasks — reuse plan-assembly.planFromSubTasks
//   - Branch 3: preferred-agents preflight — feasibility check +
//                                            counter-suggest
//   - Branch 4: lexical decomposition — Layer A→E
//
// Mutually exclusive by request shape — no fallthrough, no chain.

import type {
  ChatPlannerRequest,
  ExecutionPlan,
  IsoTimestamp,
  MetadataPlannerRequest,
  NonEmpty,
  NormalPlannerRequest,
  OctSecurePlannerRequest,
  PlanRejection,
  PlanRejectionReason,
  Planner,
  PlannerContext,
  PlannerPlanTrace,
  PlannerRequest,
  PlannerTraceReader,
  RejectionCheckbackPayload,
  SectionedPlannerRequest,
  Sha256Hex,
  Uuid,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import {
  attachOutputContractTemplate,
  buildChatPlan,
  planFromSubTasks,
  planOctSecure,
  reject,
  type PlanAssemblyDeps,
} from '@nexus/orch-ref';
import { createHash } from 'node:crypto';
import { decomposeLexically } from './internal/lexical-decomposition.js';
import { resolveLexical } from './internal/lexical-resolver.js';
import { runPreflight } from './internal/preflight.js';
import type { LexiconTablesV1 } from './internal/types.js';
import { pickTemplateForPrompt, type PickedTemplate } from './output-contract-selector.js';

// ─── Package-local interface for checkback stash ───
// Symmetric with `PlannerTraceReader` but kept package-local because
// the spec §13 ratifications enumerated only the contract additions
// for the trace path; the checkback stash is a duck-typed method on
// the planner instance read by the coordinator post-plan().

export interface PlannerCheckbackReader {
  getLastRejectionCheckback(): RejectionCheckbackPayload | null;
}

// ─── Helper ───

function sha256Hex(input: string): Sha256Hex {
  return createHash('sha256').update(input, 'utf-8').digest('hex') as Sha256Hex;
}

function buildPromptDigest(prompt: string): Sha256Hex {
  return sha256Hex(prompt);
}

// ─── DbLexiconTransformerPlanner ───

export class DbLexiconTransformerPlanner
  implements Planner, PlannerTraceReader, PlannerCheckbackReader
{
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly plannerVersion: NonEmpty = '0.1.0' as NonEmpty;

  private lastTrace: PlannerPlanTrace | null = null;
  private lastRejectionCheckback: RejectionCheckbackPayload | null = null;

  constructor(
    private readonly lexiconTables: LexiconTablesV1,
    private readonly computeDigest: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid
  ) {}

  async plan(
    request: PlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    // Reset stash for this call. Coordinator reads immediately after
    // plan() returns; another plan() call MUST NOT be interleaved.
    this.lastTrace = null;
    this.lastRejectionCheckback = null;

    const deps: PlanAssemblyDeps = {
      computeDigest: this.computeDigest,
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
      orchestratorActorId: this.orchestratorActorId,
    };

    // ── Branch 0: chat tier (AMEND-nexus-planner-chat-tier-v0-2-0.md §3.1) ──
    // Fires before Branch 1. Workspace.entryMode === 'free_chat' is the
    // signed source of truth that drives this tier; symmetric Branch
    // 3-style checkback when selected agent lacks synthesize capability.
    if (request.tier === 'chat') {
      return this.planChatBranch(request, context, deps);
    }

    // ── Branch 0b: sectioned tier (outline §5 #3, §D, §J + owner ruling 2026-05-25) ──
    // Structured-template path. Reuses the normal-tier planning machinery
    // (subTasks DAG OR preferred-agents preflight) to produce a base
    // ExecutionPlan, then attaches the output contract template — user
    // pre-pick wins; else prompt->templateId lexicon match. The orch is
    // not a governor: the planner only PICKS the template; compile does
    // the actual rendering.
    if (request.tier === 'sectioned') {
      return this.planSectionedBranch(request, context, deps);
    }

    // ── Branch 1: oct_secure tier ──
    if (request.tier === 'oct_secure') {
      const result = await planOctSecure(request, context, deps);
      this.lastTrace = this.buildOctSecureTrace(request, result);
      return result;
    }

    const reqNM = request as NormalPlannerRequest | MetadataPlannerRequest;

    // ── Branch 2: pre-resolved subTasks DAG ──
    if (reqNM.subTasks && reqNM.subTasks.length > 0) {
      const result = await planFromSubTasks(reqNM, context, deps);
      this.lastTrace = this.buildPreResolvedTrace(reqNM, result);
      return result;
    }

    // ── Branch 3: preferred-agents preflight ──
    if (reqNM.selectedAgentIds.length > 0) {
      const pre = await runPreflight({
        request: reqNM,
        context,
        tables: this.lexiconTables,
        computeDigest: this.computeDigest,
        plannerType: this.plannerType,
        plannerVersion: this.plannerVersion,
        orchestratorActorId: this.orchestratorActorId,
      });

      switch (pre.kind) {
        case 'pass':
          this.lastTrace = this.buildPreflightTrace(reqNM, pre, 'plan_created', null, null);
          return pre.plan;
        case 'reject_with_suggestions':
          this.lastRejectionCheckback = pre.checkback;
          this.lastTrace = this.buildPreflightTrace(
            reqNM,
            pre,
            'plan_rejected_no_capable_agent',
            'no_capable_agent',
            pre.rejection.reasonDetail
          );
          return pre.rejection;
        case 'reject_malformed':
          this.lastTrace = this.buildPreflightMalformedTrace(reqNM, pre.rejection);
          return pre.rejection;
        case 'reject_from_assembly':
          this.lastTrace = this.buildPreflightAssemblyRejectTrace(reqNM, pre.rejection);
          return pre.rejection;
      }
    }

    // ── Branch 4: lexical decomposition (normal tier with prompt) ──
    if (reqNM.tier === 'normal' && reqNM.prompt) {
      return this.lexicalDecompositionBranch(reqNM, context, deps);
    }

    // No branch matched — malformed request
    const malformed = reject(
      'malformed_request',
      'metadata-tier request without subTasks or selectedAgentIds is malformed in V1'
    );
    this.lastTrace = this.buildMalformedRequestTrace(reqNM, malformed);
    return malformed;
  }

  getLastTrace(): PlannerPlanTrace | null {
    return this.lastTrace;
  }

  getLastRejectionCheckback(): RejectionCheckbackPayload | null {
    return this.lastRejectionCheckback;
  }

  // ─── Branch 0 implementation (chat tier) ───
  // AMEND-nexus-planner-chat-tier-v0-2-0.md §3.2.

  private async planChatBranch(
    request: ChatPlannerRequest,
    context: PlannerContext,
    deps: PlanAssemblyDeps
  ): Promise<ExecutionPlan | PlanRejection> {
    const promptDigest = buildPromptDigest(request.prompt);
    const synthesize: NonEmpty = 'synthesize:content' as NonEmpty;
    const operatorPreference: PlannerPlanTrace['operatorPreference'] = {
      selectedAgentIds: [...request.selectedAgentIds] as Uuid[],
      preferredEndpointId: request.preferredEndpointId,
    };

    // 1. Selection cardinality — defensive runtime check even though the
    //    tuple type narrows length === 1 at the callsite (runtime callers
    //    can violate the type via cast).
    if (request.selectedAgentIds.length !== 1) {
      const rejection = reject(
        'malformed_request',
        `chat tier requires exactly one selectedAgentId; received ${request.selectedAgentIds.length}`
      );
      this.lastTrace = this.buildChatTrace(
        request,
        promptDigest,
        'not_applicable',
        'plan_rejected_malformed',
        rejection.reason,
        rejection.reasonDetail,
        operatorPreference,
        false
      );
      return rejection;
    }

    const agentId = request.selectedAgentIds[0];

    // 2. Agent existence — no checkback (operator's pick references a
    //    non-existent ID; UI staleness, not a feasibility issue).
    const agent = await context.registry.getById(agentId);
    if (!agent) {
      const rejection = reject(
        'no_capable_agent',
        `chat tier selected agent ${agentId} not found in registry`
      );
      this.lastTrace = this.buildChatTrace(
        request,
        promptDigest,
        'not_applicable',
        'plan_rejected_no_capable_agent',
        rejection.reason,
        rejection.reasonDetail,
        operatorPreference,
        false
      );
      return rejection;
    }

    // 3. Capability preflight — synthesize required; symmetric Branch
    //    3-style checkback fires when missing.
    if (!agent.capabilities.includes(synthesize)) {
      const candidates = await context.registry.findByCapability(synthesize);
      const ceilingOk =
        context.capabilityCeiling.length === 0 || context.capabilityCeiling.includes(synthesize);
      const alternatives = ceilingOk
        ? candidates.filter(a => a.enabled).filter(a => a.agentId !== agent.agentId)
        : [];

      const reasonDetail =
        `chat tier requires agent with synthesize capability; ` +
        `agent ${agent.agentId} capabilities: [${agent.capabilities.join(', ')}]`;
      const rejection = reject('no_capable_agent', reasonDetail);

      this.lastRejectionCheckback = {
        reason: 'no_capable_agent',
        reasonDetail: reasonDetail as NonEmpty,
        missingCapabilities: [synthesize],
        rejectedSelectedAgentIds: [agent.agentId as Uuid],
        recommendedSelectedAgentIds:
          alternatives.length > 0 ? [alternatives[0]!.agentId as Uuid] : [],
        alternativesByCapability: {
          [synthesize]: alternatives.map(a => ({
            agentId: a.agentId as Uuid,
            capability: synthesize,
            reason: `agent ${a.agentId} has synthesize in capabilities` as NonEmpty,
          })),
        },
      };
      this.lastTrace = this.buildChatTrace(
        request,
        promptDigest,
        'preferred_agents_insufficient_alternatives_suggested',
        'plan_rejected_no_capable_agent',
        rejection.reason,
        rejection.reasonDetail,
        operatorPreference,
        false
      );
      return rejection;
    }

    // 4. Capability ceiling check — only fires when ceiling is non-empty.
    //    Empty ceiling = no filter (isVisible convention from plan-assembly).
    if (context.capabilityCeiling.length > 0 && !context.capabilityCeiling.includes(synthesize)) {
      const rejection = reject(
        'capability_outside_ceiling',
        `chat tier requires 'synthesize' but it is not in workspace capability ceiling`
      );
      this.lastTrace = this.buildChatTrace(
        request,
        promptDigest,
        'not_applicable',
        'plan_rejected_capability_outside_ceiling',
        rejection.reason,
        rejection.reasonDetail,
        operatorPreference,
        false
      );
      return rejection;
    }

    // 5. Single-node plan via plan-assembly helper. No edges, no output
    //    contract — pass-through compile fires downstream.
    const plan = buildChatPlan({
      runId: request.runId,
      agentId: agent.agentId as Uuid,
      prompt: request.prompt,
      deps,
    });
    this.lastTrace = this.buildChatTrace(
      request,
      promptDigest,
      'preferred_agents_satisfy',
      'plan_created',
      null,
      null,
      operatorPreference,
      true
    );
    return plan;
  }

  // ─── Branch 0b implementation (sectioned tier) ───
  //
  // Outline §5 #3 + §D + owner ruling 2026-05-25.
  //
  // The sectioned-tier request structurally mirrors NormalPlannerRequest:
  // it carries `prompt`, `selectedAgentIds`, optional `subTasks` /
  // `subTaskEdges`. The PLANNING (which agents, which DAG) reuses the
  // same machinery as normal tier — there is no separate sectioned-DAG
  // shape. The ONLY sectioned-specific behavior is template attachment:
  //   - user pre-pick (request.userOutputContractTemplate) wins;
  //   - else the prompt->templateId lexicon mapper picks;
  //   - else no template (compile follows HL #11 pass-through).
  //
  // V1 vertical-slice scope: only the subTasks-present subpath is
  // supported. selectedAgents-preflight and lexical-decomposition for
  // sectioned tier are follow-on commits (the existing inner machinery
  // expects a NormalPlannerRequest type; widening it is out of scope
  // for this slice). Sectioned requests without subTasks return a
  // typed PlanRejection so the boundary is honest — not a stub.

  private async planSectionedBranch(
    request: SectionedPlannerRequest,
    context: PlannerContext,
    deps: PlanAssemblyDeps
  ): Promise<ExecutionPlan | PlanRejection> {
    if (!request.subTasks || request.subTasks.length === 0) {
      // Sectioned without an explicit sub-task DAG is a follow-on case
      // (planner-picks-agents-from-lexicon-for-sectioned). Reject
      // honestly so the caller sees the boundary instead of silent
      // default-template behavior.
      return reject(
        'malformed_request',
        'sectioned tier without subTasks is not supported in V1 ' +
          '(future: lexical decomposition for sectioned)'
      );
    }

    // Construct a shadow NormalPlannerRequest from the sectioned
    // request so we can call the shared planFromSubTasks helper with
    // honest types — no casts. The shadow has identical execution
    // semantics; only the template-attachment step below differs.
    const shadowNormal: NormalPlannerRequest = {
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
      enteredAt: request.enteredAt,
      preferredEndpointId: request.preferredEndpointId,
      subTasks: request.subTasks,
      subTaskEdges: request.subTaskEdges ?? null,
    };

    const plan = await planFromSubTasks(shadowNormal, context, deps);
    // Preserve the existing pre-resolved trace shape so consumers that
    // read `lastTrace` (the coordinator) see the same path detail.
    this.lastTrace = this.buildPreResolvedTrace(shadowNormal, plan);

    if ('rejected' in plan) {
      return plan;
    }

    // Pick the template. User pre-pick beats lexicon match; both are
    // OPTIONAL — when neither resolves, return the plan as-is and
    // compile follows HL #11 (default-template-generator for multi-item).
    const picked: PickedTemplate | null =
      request.userOutputContractTemplate !== null
        ? {
            templateId: request.userOutputContractTemplate.templateId,
            templateVersion: request.userOutputContractTemplate.templateVersion,
          }
        : pickTemplateForPrompt(request.prompt);

    if (picked === null) {
      return plan;
    }

    return attachOutputContractTemplate(
      plan,
      picked.templateId,
      picked.templateVersion,
      this.computeDigest
    );
  }

  private buildChatTrace(
    request: ChatPlannerRequest,
    promptDigest: Sha256Hex,
    preflightOutcome: PlannerPlanTrace['preflightOutcome'],
    planOutcome: PlannerPlanTrace['planOutcome'],
    rejectionReason: PlanRejectionReason | null,
    rejectionDetail: NonEmpty | null,
    operatorPreference: PlannerPlanTrace['operatorPreference'],
    candidatePopulated: boolean
  ): PlannerPlanTrace {
    const trace = this.baseTrace(promptDigest, nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'chat';
    trace.operatorPreference = operatorPreference;
    trace.preflightOutcome = preflightOutcome;
    trace.requiredCapabilities = ['synthesize:content' as NonEmpty];
    trace.candidateAgents = candidatePopulated
      ? [
          {
            capability: 'synthesize:content' as NonEmpty,
            agentIds: [request.selectedAgentIds[0]],
          },
        ]
      : [];
    trace.planOutcome = planOutcome;
    trace.rejectionReason = rejectionReason;
    trace.rejectionDetail = rejectionDetail;
    return trace;
  }

  // ─── Branch 4 implementation ───

  private async lexicalDecompositionBranch(
    request: NormalPlannerRequest,
    context: PlannerContext,
    deps: PlanAssemblyDeps
  ): Promise<ExecutionPlan | PlanRejection> {
    const resolution = resolveLexical(request.prompt, this.lexiconTables);
    const decomposed = await decomposeLexically(
      request.prompt,
      resolution,
      this.lexiconTables,
      context
    );

    switch (decomposed.kind) {
      case 'plan': {
        // Synthesize a derived request with subTasks + subTaskEdges
        // populated, then delegate to plan-assembly.planFromSubTasks
        // for full 14+1 validation + ExecutionPlan emission.
        const derivedRequest: NormalPlannerRequest = {
          ...request,
          subTasks: decomposed.subTasks,
          subTaskEdges: decomposed.subTaskEdges,
        };
        const result = await planFromSubTasks(derivedRequest, context, deps);
        this.lastTrace = this.buildLexicalTrace(
          request,
          resolution,
          decomposed,
          'rejected' in result ? mapAssemblyRejectionToPlanOutcome(result) : 'plan_created',
          'rejected' in result ? result.reason : null,
          'rejected' in result ? result.reasonDetail : null
        );
        return result;
      }
      case 'ambiguous': {
        const rejection = reject(
          'unmappable_request',
          `ambiguous_intent: ${decomposed.reasonDetail}`
        );
        this.lastTrace = this.buildLexicalTraceAmbiguous(
          request,
          resolution,
          decomposed,
          rejection
        );
        return rejection;
      }
      case 'no_intent': {
        const rejection = reject('unmappable_request', decomposed.reasonDetail);
        this.lastTrace = this.buildLexicalTraceNoIntent(request, resolution, decomposed, rejection);
        return rejection;
      }
      case 'no_agent': {
        const rejection = reject('no_capable_agent', decomposed.reasonDetail);
        // Also stash a checkback payload from Branch 4's no-agent
        // result so coordinator can surface a checkback even on the
        // lexical-decomposition branch when alternatives exist.
        this.lastRejectionCheckback = {
          reason: 'no_capable_agent',
          reasonDetail: rejection.reasonDetail,
          missingCapabilities: decomposed.missingCapabilities,
          rejectedSelectedAgentIds: [],
          recommendedSelectedAgentIds: [],
          alternativesByCapability: {},
        };
        this.lastTrace = this.buildLexicalTraceNoAgent(request, resolution, decomposed, rejection);
        return rejection;
      }
      case 'blocked': {
        const rejection = reject('unmappable_request', decomposed.reasonDetail);
        this.lastTrace = this.buildLexicalTraceBlocked(request, resolution, rejection);
        return rejection;
      }
    }
  }

  // ─── Trace builders ───
  // Centralized so the shape of PlannerPlanTrace stays one place. Each
  // branch produces a trace with the right `branch` discriminator and
  // populates the fields it has data for; absent fields use the empty
  // / null sentinels declared in the contract.

  private baseTrace(promptDigest: Sha256Hex | null, emittedAt: IsoTimestamp): PlannerPlanTrace {
    return {
      runId: '00000000-0000-0000-0000-000000000000' as Uuid, // overwritten below
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
      promptDigest,
      branch: 'oct_secure', // overwritten below
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
      emittedAt,
    };
  }

  private buildOctSecureTrace(
    request: OctSecurePlannerRequest,
    result: ExecutionPlan | PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(null, nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'oct_secure';
    trace.preflightOutcome = 'not_applicable';
    if ('rejected' in result) {
      trace.planOutcome = 'plan_rejected_malformed';
      trace.rejectionReason = result.reason;
      trace.rejectionDetail = result.reasonDetail;
    }
    return trace;
  }

  private buildPreResolvedTrace(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    result: ExecutionPlan | PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(
      request.tier === 'normal' ? buildPromptDigest(request.prompt) : null,
      nowIso() as IsoTimestamp
    );
    trace.runId = request.runId;
    trace.branch = 'pre_resolved_sub_tasks';
    trace.preflightOutcome = 'not_applicable';
    if ('rejected' in result) {
      trace.planOutcome = mapAssemblyRejectionToPlanOutcome(result);
      trace.rejectionReason = result.reason;
      trace.rejectionDetail = result.reasonDetail;
    }
    return trace;
  }

  private buildPreflightTrace(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    pre: {
      requiredCapabilities: NonEmpty[];
      candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
    },
    planOutcome: PlannerPlanTrace['planOutcome'],
    rejectionReason: PlanRejectionReason | null,
    rejectionDetail: NonEmpty | null
  ): PlannerPlanTrace {
    const trace = this.baseTrace(
      request.tier === 'normal' ? buildPromptDigest(request.prompt) : null,
      nowIso() as IsoTimestamp
    );
    trace.runId = request.runId;
    trace.branch = 'preflight_preferred_agents';
    trace.operatorPreference = {
      selectedAgentIds: [...request.selectedAgentIds],
      preferredEndpointId:
        request.tier === 'normal' || request.tier === 'metadata'
          ? request.preferredEndpointId
          : null,
    };
    trace.preflightOutcome =
      planOutcome === 'plan_created'
        ? 'preferred_agents_satisfy'
        : 'preferred_agents_insufficient_alternatives_suggested';
    trace.requiredCapabilities = [...pre.requiredCapabilities];
    trace.candidateAgents = [...pre.candidateAgents];
    trace.planOutcome = planOutcome;
    trace.rejectionReason = rejectionReason;
    trace.rejectionDetail = rejectionDetail;
    return trace;
  }

  private buildPreflightMalformedTrace(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(
      request.tier === 'normal' ? buildPromptDigest(request.prompt) : null,
      nowIso() as IsoTimestamp
    );
    trace.runId = request.runId;
    trace.branch = 'preflight_preferred_agents';
    trace.operatorPreference = {
      selectedAgentIds: [...request.selectedAgentIds],
      preferredEndpointId:
        request.tier === 'normal' || request.tier === 'metadata'
          ? request.preferredEndpointId
          : null,
    };
    trace.preflightOutcome = 'not_applicable';
    trace.planOutcome = 'plan_rejected_malformed';
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildPreflightAssemblyRejectTrace(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(
      request.tier === 'normal' ? buildPromptDigest(request.prompt) : null,
      nowIso() as IsoTimestamp
    );
    trace.runId = request.runId;
    trace.branch = 'preflight_preferred_agents';
    trace.operatorPreference = {
      selectedAgentIds: [...request.selectedAgentIds],
      preferredEndpointId:
        request.tier === 'normal' || request.tier === 'metadata'
          ? request.preferredEndpointId
          : null,
    };
    trace.preflightOutcome = 'preferred_agents_satisfy';
    trace.planOutcome = mapAssemblyRejectionToPlanOutcome(rejection);
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildLexicalTrace(
    request: NormalPlannerRequest,
    resolution: ReturnType<typeof resolveLexical>,
    decomposed: {
      candidateIntents: NonEmpty[];
      selectedIntent: NonEmpty;
      candidateTemplates: NonEmpty[];
      selectedTemplate: NonEmpty;
      requiredCapabilities: NonEmpty[];
      candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
    },
    planOutcome: PlannerPlanTrace['planOutcome'],
    rejectionReason: PlanRejectionReason | null,
    rejectionDetail: NonEmpty | null
  ): PlannerPlanTrace {
    const trace = this.baseTrace(buildPromptDigest(request.prompt), nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition';
    trace.operatorPreference = null;
    trace.preflightOutcome = 'not_applicable';
    trace.lexicalMatches = lexicalMatchesFromResolution(resolution);
    trace.candidateIntents = [...decomposed.candidateIntents];
    trace.selectedIntent = decomposed.selectedIntent;
    trace.candidateTemplates = [...decomposed.candidateTemplates];
    trace.selectedTemplate = decomposed.selectedTemplate;
    trace.requiredCapabilities = [...decomposed.requiredCapabilities];
    trace.candidateAgents = [...decomposed.candidateAgents];
    trace.planOutcome = planOutcome;
    trace.rejectionReason = rejectionReason;
    trace.rejectionDetail = rejectionDetail;
    return trace;
  }

  private buildLexicalTraceAmbiguous(
    request: NormalPlannerRequest,
    resolution: ReturnType<typeof resolveLexical>,
    decomposed: {
      candidateIntents: NonEmpty[];
      candidateTemplates: NonEmpty[];
      reasonDetail: string;
    },
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(buildPromptDigest(request.prompt), nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition';
    trace.preflightOutcome = 'not_applicable';
    trace.lexicalMatches = lexicalMatchesFromResolution(resolution);
    trace.candidateIntents = [...decomposed.candidateIntents];
    trace.candidateTemplates = [...decomposed.candidateTemplates];
    trace.planOutcome = 'plan_rejected_ambiguous';
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildLexicalTraceNoIntent(
    request: NormalPlannerRequest,
    resolution: ReturnType<typeof resolveLexical>,
    _decomposed: { reasonDetail: string },
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(buildPromptDigest(request.prompt), nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition';
    trace.preflightOutcome = 'not_applicable';
    trace.lexicalMatches = lexicalMatchesFromResolution(resolution);
    trace.planOutcome = 'plan_rejected_ambiguous'; // closest available enum for "no intent matched"
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildLexicalTraceNoAgent(
    request: NormalPlannerRequest,
    resolution: ReturnType<typeof resolveLexical>,
    decomposed: {
      candidateIntents: NonEmpty[];
      selectedIntent: NonEmpty;
      candidateTemplates: NonEmpty[];
      selectedTemplate: NonEmpty;
      requiredCapabilities: NonEmpty[];
    },
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(buildPromptDigest(request.prompt), nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition';
    trace.preflightOutcome = 'not_applicable';
    trace.lexicalMatches = lexicalMatchesFromResolution(resolution);
    trace.candidateIntents = [...decomposed.candidateIntents];
    trace.selectedIntent = decomposed.selectedIntent;
    trace.candidateTemplates = [...decomposed.candidateTemplates];
    trace.selectedTemplate = decomposed.selectedTemplate;
    trace.requiredCapabilities = [...decomposed.requiredCapabilities];
    trace.planOutcome = 'plan_rejected_no_capable_agent';
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildLexicalTraceBlocked(
    request: NormalPlannerRequest,
    resolution: ReturnType<typeof resolveLexical>,
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(buildPromptDigest(request.prompt), nowIso() as IsoTimestamp);
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition';
    trace.preflightOutcome = 'not_applicable';
    trace.lexicalMatches = lexicalMatchesFromResolution(resolution);
    trace.planOutcome = 'plan_rejected_ambiguous';
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }

  private buildMalformedRequestTrace(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    rejection: PlanRejection
  ): PlannerPlanTrace {
    const trace = this.baseTrace(
      request.tier === 'normal' ? buildPromptDigest(request.prompt) : null,
      nowIso() as IsoTimestamp
    );
    trace.runId = request.runId;
    trace.branch = 'lexical_decomposition'; // closest available enum
    trace.preflightOutcome = 'not_applicable';
    trace.planOutcome = 'plan_rejected_malformed';
    trace.rejectionReason = rejection.reason;
    trace.rejectionDetail = rejection.reasonDetail;
    return trace;
  }
}

// ─── Helpers ───

function mapAssemblyRejectionToPlanOutcome(
  rejection: PlanRejection
): PlannerPlanTrace['planOutcome'] {
  switch (rejection.reason) {
    case 'no_capable_agent':
      return 'plan_rejected_no_capable_agent';
    case 'capability_outside_ceiling':
      return 'plan_rejected_capability_outside_ceiling';
    case 'max_split_exceeded':
      return 'plan_rejected_max_split_exceeded';
    case 'malformed_request':
    case 'structural_constraint':
    case 'unmappable_request':
      return 'plan_rejected_malformed';
  }
}

function lexicalMatchesFromResolution(
  resolution: ReturnType<typeof resolveLexical>
): PlannerPlanTrace['lexicalMatches'] {
  // `aliasRule` is an OPTIONAL field on the trace match shape — under
  // `exactOptionalPropertyTypes: true` we must omit it entirely when
  // the rule isn't present (not set to undefined).
  const out: PlannerPlanTrace['lexicalMatches'] = [
    ...resolution.verbs.map(v =>
      v.aliasRule !== null
        ? {
            rawTerm: v.rawTerm,
            canonicalTerm: v.canonicalVerb,
            phraseClass: 'verb' as const,
            aliasRule: v.aliasRule,
          }
        : {
            rawTerm: v.rawTerm,
            canonicalTerm: v.canonicalVerb,
            phraseClass: 'verb' as const,
          }
    ),
    ...resolution.targets.map(t => ({
      rawTerm: t.rawTerm,
      canonicalTerm: t.targetTerm,
      phraseClass: 'noun' as const,
    })),
    ...resolution.operands.map(o => ({
      rawTerm: o.rawTerm,
      canonicalTerm: o.operand,
      phraseClass: 'business_phrase' as const,
    })),
  ];
  return out;
}
