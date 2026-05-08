#!/usr/bin/env tsx
/**
 * Nexus CLI — composition root entry point — UNLAYERED
 *
 * This file lives OUTSIDE the seven-layer package architecture (scripts/).
 * It is the sole point where cross-layer construction occurs for the CLI binary.
 * Cross-layer imports are permitted here because this is a composition root.
 *
 * NISP-001.A: wires the 12-step bootstrap (§32a.6) via nexus-bootstrap.ts.
 * The bootstrap result is lazily initialized — only commands that need
 * transport or manifest-loaded state trigger the full startup sequence.
 * The --help path and non-transport commands use the pre-existing factories.
 *
 * COMPOSE-001 fix: serve command uses bootstrapNvgService (wired, lazy)
 * instead of createNvgService (empty). Ad-hoc CLI commands (classify, route)
 * keep the lightweight empty NvgServiceImpl for individual method calls.
 *
 * MODULAR-S29-002 fix: removed @nexus/vanguard from CLI package dependencies.
 * NVG service construction happens here; CLI commands receive Layer 2 interfaces only.
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §22.1
 * Blueprint: nexus-blueprint-v1-5-13.md §24.8
 * Bootstrap: AMEND-spec F-09 §32a.6 (12 steps)
 */

import {
  NvgServiceImpl,
  JsonlRoutingTrailReader,
  loadNvgRoutingPolicy as loadNvgPolicyYaml,
} from '@nexus/vanguard';
import {
  SimpleConnectorRegistry,
  SimpleChannelRegistry,
  canonicalize,
  verify,
  loadControlPlaneKey,
  mintRootDelegation,
  RegistryBackedIdentityProvider,
} from '@nexus/core';
import { StubConnector } from '@nexus/connector-stub';
import { createCli } from '@nexus/cli';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import type {
  Sha256Hex,
  Uuid,
  NonEmpty,
  IsoTimestamp,
  OrchestratorPlanPreview,
  WorkspaceRunRequest,
  PlannerRequest,
  PlanNode,
  Session,
} from '@nexus/contracts';
import { addSeconds, nowIso, riskTierExceeds } from '@nexus/contracts';
import { bootstrap, bootstrapWorkspace, type BootstrapResult } from './nexus-bootstrap.js';
import { ActorRegistryAgentReader } from './ref-agent-registry-reader.js';
import {
  RefOrchestrator,
  RefRunCoordinator,
  RefDeterministicPlanner,
  RefDagExecutor,
} from '@nexus/orch-ref';
import type { NodeDispatchResult, DelegationScope } from '@nexus/orch-ref';
// NXS Pipeline — relative imports (composition root cross-layer)
import { Pipeline } from '../packages/core/src/engine/pipeline.js';
import { IdentityGate } from '../packages/core/src/gates/01-identity.gate.js';
import { ClassificationGate } from '../packages/core/src/gates/02-classification.gate.js';
import { DelegationGate } from '../packages/core/src/gates/03-delegation.gate.js';
import { PolicyGate } from '../packages/core/src/gates/04-policy.gate.js';
import { ApprovalGate } from '../packages/core/src/gates/05-approval.gate.js';
import { ExecutionGate } from '../packages/core/src/gates/06-execution.gate.js';
import { EvidenceGate } from '../packages/core/src/gates/07-evidence.gate.js';
import { VerbNormalizer } from '../packages/core/src/classification/verb-normalizer.js';
import { LexicalVerbResolver } from '../packages/core/src/classification/lexical-verb-resolver.js';
import { TargetNormalizer } from '../packages/core/src/classification/target-normalizer.js';
import { DataClassifier } from '../packages/core/src/classification/data-classifier.js';
import { RiskClassifier } from '../packages/core/src/classification/risk-classifier.js';
import { CapabilityRegistry } from '../packages/core/src/classification/capability-registry.js';
import { ReplayDetector } from '../packages/core/src/security/replay-detector.js';
import { RateLimiter } from '../packages/core/src/security/rate-limiter.js';
import { loadModeConfig } from '../packages/core/src/modes/mode-manager.js';

const DEFAULT_TRAIL_DIR = path.join(process.cwd(), 'runs');

// ---------------------------------------------------------------------------
// Lazy bootstrap — §32a.6.
// Cached so the 12-step sequence runs at most once per process lifetime.
// The serve command calls getBootstrap() via bootstrapNvgService.
// Ad-hoc commands (--help, classify, route, trail) skip bootstrap.
// ---------------------------------------------------------------------------
let _bootstrapResult: BootstrapResult | null = null;

async function getBootstrap(): Promise<BootstrapResult> {
  if (_bootstrapResult === null) {
    _bootstrapResult = await bootstrap(DEFAULT_TRAIL_DIR);
  }
  return _bootstrapResult;
}

const program = createCli({
  createNvgService: () => new NvgServiceImpl(),
  createTrailReader: (dir?: string) => new JsonlRoutingTrailReader(dir ?? DEFAULT_TRAIL_DIR),
  loadNvgRoutingPolicy: async (filepath: string) => {
    const key = await loadControlPlaneKey();
    return loadNvgPolicyYaml(filepath, key.publicKey, { verify, canonicalize });
  },
  createConnectorRegistry: () => {
    const reg = new SimpleConnectorRegistry();
    reg.register(new StubConnector());
    return reg;
  },
  bootstrapNvgService: async () => {
    const br = await getBootstrap();
    return br.nvgService;
  },
  bootstrapWorkspaceApiDeps: async coreDeps => {
    const br = await getBootstrap();
    // Claude C / SPEC-addendum-beta1-admin-dashboard §3.2:
    // pipe connectorRecords + endpointRecords into the catalog reader so
    // listConnectors/listModels emit claims-filtered data instead of [].
    const wsDeps = await bootstrapWorkspace(coreDeps, {
      connectorRecords: br.externals.connectorRecords,
      endpointRecords: br.endpoints,
    });
    const computeDigest = (obj: unknown): Sha256Hex =>
      createHash('sha256').update(canonicalize(obj)).digest('hex') as Sha256Hex;

    // ── ORCH-WIRE-001: Step 22 — Orchestrator assembly ──────────────────
    const orchManifest = br.externals.orchestratorSockets[0];
    if (!orchManifest) {
      console.log('[orch-wire] No orchestrator manifest — dispatch disabled');
      return {
        ...wsDeps,
        // Manifest records for admin-setup projection (Claude C)
        identityRecords: br.externals.identityRecords,
        connectorRecords: br.externals.connectorRecords,
        channelRecords: br.externals.channelRecords,
        workspaceSockets: br.externals.workspaceSockets,
        mailboxRecords: br.externals.mailboxRecords,
        compilerRecords: br.externals.compilerRecords,
        compileReturnRecords: br.externals.compileReturnEndpoints,
        endpoints: br.endpoints,
        computeDigest,
      };
    }
    console.log('[orch-wire] Step 22: assembling orchestrator...');

    // 22a. NXS Pipeline (real, all 7 gates)
    const controlPlaneKey = await loadControlPlaneKey();
    const modeConfig = await loadModeConfig(path.join(process.cwd(), 'keys', 'mode-config.json'));
    const capRegistry = new CapabilityRegistry();
    const pipelineIdp = new RegistryBackedIdentityProvider(
      coreDeps.actorRegistry,
      coreDeps.principalRegistry
    );
    const nxsPipeline = new Pipeline(
      {
        identity: new IdentityGate(
          coreDeps.actorRegistry,
          // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §2.2 step A — real session
          // store so dispatchToGovernance can create per-run sessions that
          // Gate 01 actually finds (was a stub returning null).
          coreDeps.sessionStore,
          coreDeps.principalRegistry,
          coreDeps.delegationStore,
          pipelineIdp
        ),
        classification: new ClassificationGate(
          new VerbNormalizer(LexicalVerbResolver.loadFromFixture(process.cwd())),
          new TargetNormalizer(),
          new DataClassifier(),
          new RiskClassifier(capRegistry)
        ),
        delegation: new DelegationGate(controlPlaneKey),
        policy: new PolicyGate(),
        approval: new ApprovalGate(controlPlaneKey),
        execution: new ExecutionGate(controlPlaneKey),
        evidence: new EvidenceGate(coreDeps.ledgerBackend, controlPlaneKey),
      },
      new ReplayDetector(coreDeps.db),
      new RateLimiter(),
      coreDeps.db,
      modeConfig
    );
    console.log('[orch-wire] NXS Pipeline constructed (7 gates)');

    // 22b. AgentRegistryReader — projection over canonical NXS ActorRegistry
    const agentRegistry = new ActorRegistryAgentReader(coreDeps.actorRegistry);

    // 22c. Planner + DAG executor
    const planner = new RefDeterministicPlanner(computeDigest, orchManifest.orchestratorActorId);
    const dagExecutor = new RefDagExecutor(orchManifest.partialCompletion);

    // 22d. Factory: makeDispatchToGovernance — closes over the requesting
    // user's principalId and creates real per-run sessions.
    // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §2.2.
    const makeDispatchToGovernance = (requestingPrincipalId: Uuid) => {
      return async (node: PlanNode, delegationId: Uuid): Promise<NodeDispatchResult> => {
        try {
          // Real session bound to the requesting user's principal + this
          // agent + this delegation, so Gate 01 tuple-binding checks pass.
          const createdAt = nowIso();
          const session: Session = {
            sessionId: crypto.randomUUID() as Uuid,
            actorId: node.agentId,
            principalId: requestingPrincipalId,
            delegationId,
            createdAt,
            expiresAt: addSeconds(createdAt, 3600),
          };
          await coreDeps.sessionStore.create(session);

          const action = {
            actionId: crypto.randomUUID() as Uuid,
            runId: node.nodeId,
            receivedAt: nowIso(),
            protocol: 'nexus-orch/v1.0.0' as NonEmpty,
            adapterVersion: '1.0.0' as NonEmpty,
            actorId: node.agentId,
            // FIXED: requesting user's principal, not the orchestrator actor
            principalId: requestingPrincipalId,
            // FIXED: real session that exists in the store
            sessionId: session.sessionId,
            delegationId,
            delegationSequence: 0,
            tool: node.taskSummary,
            rawVerb: node.taskSummary,
            rawTarget: node.taskSummary,
            rawPayload: null,
            intent: {
              objectiveSummary: node.taskSummary,
              triggeringSource: 'orchestrator' as NonEmpty,
              toolchainContext: 'nexus-orch' as NonEmpty,
              modelId: null,
              modelConfidence: null,
              riskNote: null,
              extractedAt: nowIso(),
            },
            resolvedVerb: null,
            resolvedCapability: null,
            resolvedTarget: null,
            resolvedDataClasses: [] as string[],
            resolvedRiskTier: null,
          };
          const ctx = {
            actor: null,
            principal: null,
            session: null,
            delegationContext: null,
            effectiveCeiling: null,
            identityClaims: null,
            gateResults: [],
            threatLog: [],
            connectorRegistry: new SimpleConnectorRegistry(),
            channelRegistry: new SimpleChannelRegistry(),
            policyFile: null,
          };
          const result = await nxsPipeline.process(action as any, ctx as any);
          const finalOutcome = result.evidenceRecord.finalOutcome;
          const denied = finalOutcome === 'deny';
          return {
            success: !denied,
            completionMetadata: denied ? null : { pipelineOutcome: finalOutcome },
            failureReason: denied ? ('governance_denied' as NonEmpty) : null,
            governanceDenied: denied,
          };
        } catch (err) {
          return {
            success: false,
            completionMetadata: null,
            failureReason: ('pipeline_error: ' + (err as Error).message) as NonEmpty,
            governanceDenied: false,
          };
        }
      };
    };

    // 22e. Factory: makeIssueDelegation — closes over the requesting user's
    // principalId. Delegation scope = lesser of agent's ceiling and principal's
    // ceiling. Blueprint §12.1, §17.3.
    // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §2.1.
    const makeIssueDelegation = (requestingPrincipalId: Uuid) => {
      return async (agentId: Uuid, _scope: DelegationScope): Promise<Uuid> => {
        try {
          const agent = await coreDeps.actorRegistry.get(agentId);
          if (!agent) throw new Error('Agent not found: ' + agentId);

          // Look up the REQUESTING USER's principal — not the agent's registrar.
          const principal = await coreDeps.principalRegistry.get(requestingPrincipalId);
          if (!principal) throw new Error('Principal not found: ' + requestingPrincipalId);

          // Systems: intersection of agent's and principal's allowed systems.
          const effectiveSystems = agent.allowedSystems.filter(
            s => principal.allowedSystems.includes('*') || principal.allowedSystems.includes(s)
          );

          // Capabilities: agent's capabilities pass through. Principal has no
          // capability field; capability scope is enforced at Gate 03 + via
          // OCT ceiling and risk-tier comparison.
          const effectiveCapabilities = agent.allowedCapabilities ?? [];

          // Risk: lesser of agent's ceiling and principal's max delegable tier.
          const effectiveRiskTier = riskTierExceeds(
            agent.riskCeiling,
            principal.maxDelegableRiskTier
          )
            ? principal.maxDelegableRiskTier
            : agent.riskCeiling;

          const dc = await mintRootDelegation(principal, agent, {
            principalId: requestingPrincipalId,
            actorId: agentId,
            allowedSystems: effectiveSystems,
            allowedCapabilities: effectiveCapabilities,
            forbiddenCapabilities: [],
            maxRiskTier: effectiveRiskTier,
            allowDownstreamPropagation: false,
            environment: agent.environment,
            expiresAt: new Date(Date.now() + 3600_000).toISOString() as IsoTimestamp,
            maxChainDepth: orchManifest.maxSplitDepth,
          });
          await coreDeps.delegationStore.save(dc);
          console.log(
            '[orch-wire] delegation issued:',
            dc.delegationId,
            'principal:',
            requestingPrincipalId,
            'agent:',
            agentId
          );
          return dc.delegationId;
        } catch (err) {
          console.error('[orch-wire] delegation failed:', (err as Error).message);
          return crypto.randomUUID() as Uuid;
        }
      };
    };

    // 22f. Glue: triggerCompile, sendPlanCheckback, buildPlannerRequest
    const triggerCompile = async (runId: Uuid): Promise<void> => {
      console.log('[orch-wire] compile triggered for run:', runId);
    };
    const sendPlanCheckback = async (_p: OrchestratorPlanPreview): Promise<boolean> => {
      console.log('[orch-wire] plan checkback auto-approved (V1)');
      return true;
    };
    const buildPlannerRequest = (request: WorkspaceRunRequest): PlannerRequest => ({
      tier: 'normal' as const,
      runId: request.runId,
      userId: request.userId,
      principalId: request.principalId,
      prompt: request.prompt,
      selectedAgentIds: request.selectedAgentIds,
      requiredCapabilities: [],
      edgeHints: [],
      workspaceSocketId: request.workspaceSocketId,
      planCheckbackRequested: request.planCheckbackRequested,
      enteredAt: nowIso(),
    });

    // 22g. Assemble coordinator + orchestrator.
    //
    // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §6 (Option B): the coordinator is
    // stateful (activeRuns map for cancellation), so we keep ONE instance and
    // pass per-request principal-bound functions to handleRun() instead of
    // recreating the coordinator on every run.
    //
    // Construction-time issueDelegation / dispatchToGovernance are fail-loud
    // stubs — every production code path should pass per-run overrides. They
    // exist only to satisfy the RunCoordinatorDeps contract (the orch-ref tests
    // exercise the construction-time path with their own mocks).
    const requirePerRunDeps = (): never => {
      throw new Error(
        '[orch-wire] handleRun called without per-run deps — requesting principalId unknown'
      );
    };
    const coordinator = new RefRunCoordinator(
      orchManifest,
      {
        planner,
        dagExecutor,
        runLedgerWriter: coreDeps.runLedgerWriter!,
        mailboxService: br.externals.mailboxService,
        outputCollector: br.externals.outputCollector,
        computeDigest,
        dispatchToGovernance: requirePerRunDeps,
        issueDelegation: requirePerRunDeps,
        triggerCompile,
        sendPlanCheckback,
        buildPlannerRequest,
        agentRegistry,
        capabilityCeiling: ['*'] as NonEmpty[],
        maxSplitDepth: orchManifest.maxSplitDepth,
      },
      orchManifest.orchestratorActorId
    );
    const orchestrator = new RefOrchestrator(
      orchManifest.orchestratorSocketId as NonEmpty,
      '1.0.0' as NonEmpty,
      coordinator
    );
    const dispatchToOrchestrator = async (request: WorkspaceRunRequest): Promise<unknown> => {
      console.log(
        '[orch-wire] dispatching for run:',
        request.runId,
        'principal:',
        request.principalId
      );
      // Build per-request issuer + dispatcher closing over the requesting
      // user's principalId, then call the coordinator directly so cancellation
      // (which keys off coordinator.activeRuns) keeps working.
      const issueDelegation = makeIssueDelegation(request.principalId);
      const dispatchToGovernance = makeDispatchToGovernance(request.principalId);
      return coordinator.handleRun(request, { issueDelegation, dispatchToGovernance });
    };
    console.log('[orch-wire] Step 22 complete: orchestrator assembled');

    return {
      ...wsDeps,
      // Manifest records for admin-setup projection (Claude C)
      identityRecords: br.externals.identityRecords,
      connectorRecords: br.externals.connectorRecords,
      channelRecords: br.externals.channelRecords,
      workspaceSockets: br.externals.workspaceSockets,
      orchestratorSockets: br.externals.orchestratorSockets,
      mailboxRecords: br.externals.mailboxRecords,
      compilerRecords: br.externals.compilerRecords,
      compileReturnRecords: br.externals.compileReturnEndpoints,
      endpoints: br.endpoints,
      orchestrator,
      dispatchToOrchestrator,
      computeDigest,
      pipelineInterface: nxsPipeline,
    };
  },
});

// Filter out bare '--' that pnpm may inject between script path and subcommands.
const argv = process.argv.filter((arg, idx) => !(arg === '--' && idx === 2));
program.parse(argv);
