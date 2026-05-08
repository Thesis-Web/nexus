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
  canonicalize,
  verify,
  loadControlPlaneKey,
  mintRootDelegation,
  RegistryBackedIdentityProvider,
  SimpleConnectorRegistry,
} from '@nexus/core';
import { StubConnector } from '@nexus/connector-stub';
import { createCli } from '@nexus/cli';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
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
  NvgOutboundRequest,
  CompileRequest,
  CompileReturnEndpointRecord,
  CompileReturnAck,
  FinalResponseArtifact,
  CompileReturnRequest,
} from '@nexus/contracts';
import { nowIso, riskTierExceeds, CAPABILITY_IDS } from '@nexus/contracts';
import { bootstrap, bootstrapWorkspace, type BootstrapResult } from './nexus-bootstrap.js';
import { ActorRegistryAgentReader } from './ref-agent-registry-reader.js';
import {
  RefOrchestrator,
  RefRunCoordinator,
  RefDeterministicPlanner,
  RefDagExecutor,
} from '@nexus/orch-ref';
import type { NodeDispatchResult, DelegationScope } from '@nexus/orch-ref';
// NXS Pipeline gates + classification — relative imports (composition root cross-layer).
// The full pipeline stays constructed so admin tooling can route AgentActions
// through it; the workspace prompt path now goes through NVG instead.
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
// E2E wiring: NVG outbound result → mailbox; compile-return verification helpers.
import { sha256Hex } from '../packages/core/src/output/output-digest.js';
import { createNvgOutputReference } from '../packages/core/src/output/output-reference-adapter.js';
import {
  verifyCallbackAuth,
  recomputeArtifactDigest,
} from '../packages/core/src/compile/compile-return-dispatcher.js';
import { verifyArtifactSignature } from '../packages/core/src/compile/final-response-signer.js';

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

    // CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — adapter from FileSecretSource (Layer 3)
    // to the SecretWriter port consumed by admin-writer.ts (Layer 7). Layer 7
    // never sees the read side (no readSecret method) — values stay in the
    // ChainedSecretSource that Vanguard's transport adapters call.
    const secretWriter = {
      writeSecret: (k: string, v: string) => br.fileSecretSource.writeSecret(k, v),
      deleteSecret: (k: string) => br.fileSecretSource.deleteSecret(k),
      listKeyNames: () => br.fileSecretSource.listKeyNames(),
      storageLabel: br.secretsStorageLabel,
    };

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
        secretWriter,
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

    // 22d. Factory: makeDispatchToGovernance — closes over the originating
    // WorkspaceRunRequest so the per-node dispatch can hand the user's prompt
    // to NVG and persist the model response into the mailbox.
    //
    // Flow per blueprint §11.4 + AMEND-spec §6.4:
    //   1. Look up agent in the canonical registry.
    //   2. Build an NvgOutboundRequest from the prompt + plan node + agent
    //      claims. Ollama's chat schema expects messages: [{role,content}], so
    //      the payload mirrors that shape (transport adapter passes through).
    //   3. Call nvgService.classifyAndRoute — classify, route, ceiling, invoke,
    //      RPT. In nvgMode='enforce' this actually invokes the model.
    //   4. On allow + invocation success: persist response bytes to disk, build
    //      an NvgOutputReference, hand it to OutputCollector. The collector
    //      verifies the digest via the file:// resolver, writes the mailbox
    //      item, and emits partial_result on the run ledger.
    //   5. Return NodeDispatchResult so the DAG executor records node_completed.
    const makeDispatchToGovernance = (request: WorkspaceRunRequest) => {
      return async (node: PlanNode, _delegationId: Uuid): Promise<NodeDispatchResult> => {
        try {
          const agent = await coreDeps.actorRegistry.get(node.agentId);
          if (!agent) throw new Error('Agent not found in registry: ' + node.agentId);

          const nvgRequest: NvgOutboundRequest = {
            requestId: crypto.randomUUID() as Uuid,
            runId: request.runId,
            actorId: node.agentId,
            octLevel: agent.octLevel ?? 'OCT-OPEN',
            environmentContext: agent.environment,
            taskIntent: node.taskSummary,
            // Ollama chat schema: messages[]. The transport adapter passes
            // request.payload through to the provider unmodified.
            payload: [{ role: 'user', content: request.prompt }],
            dataLabels: [],
            costPreference: 'standard',
            latencyPreference: 'standard',
            // CLAUDE-CODE-MODEL-SELECTION-SPEC §2b — surface the user's
            // dropdown preference. NVG treats it as a weighted suggestion
            // within the governed tier set; null = Auto (policy).
            preferredEndpointId: request.preferredEndpointId,
          };

          console.log(
            '[orch-wire] NVG dispatch — run:',
            request.runId,
            'agent:',
            node.agentId,
            'task:',
            node.taskSummary
          );
          const result = await br.nvgService.classifyAndRoute(nvgRequest);
          console.log(
            '[nvg] classification:',
            result.classification.effectiveDataClass,
            'route:',
            result.modelTierSelected ?? '<none>',
            'disposition:',
            result.disposition
          );

          if (!result.allowed) {
            console.warn(
              '[nvg] denied —',
              result.denialCode ?? 'unknown',
              ':',
              result.denialReason ?? ''
            );
            return {
              success: false,
              completionMetadata: null,
              failureReason: ((result.denialCode ?? 'nvg_denied') +
                ': ' +
                (result.denialReason ?? '')) as NonEmpty,
              governanceDenied: true,
            };
          }

          const inv = result.invocation;
          if (!inv || !inv.success) {
            const reason = inv?.reason ?? 'invocation_unavailable';
            const code = inv?.denialCode ?? 'invocation_failed';
            console.warn('[nvg] invocation failed —', code, ':', reason);
            return {
              success: false,
              completionMetadata: null,
              failureReason: (code + ': ' + reason) as NonEmpty,
              governanceDenied: false,
            };
          }

          // Extract assistant text from the opaque provider response. NVG
          // never inspects this payload (§13.7.1) — extraction happens here at
          // the composition boundary so we can persist + digest the bytes.
          const raw = inv.opaqueProviderResponse as { message?: { content?: unknown } } | undefined;
          const content = typeof raw?.message?.content === 'string' ? raw.message.content : '';
          console.log(
            '[nvg] model response —',
            inv.responseSize ?? 0,
            'bytes,',
            inv.latencyMs ?? 0,
            'ms, tier:',
            result.modelTierInvoked ?? '<unknown>'
          );

          // Persist response bytes to disk so the registered file:// payload
          // resolver can read them back to verify the digest before mailbox
          // write. The same resolver is used by DeterministicRenderer.
          const payloadDir = path.join(process.cwd(), 'runs', 'payloads', request.runId);
          await fs.mkdir(payloadDir, { recursive: true });
          const payloadPath = path.join(payloadDir, nvgRequest.requestId + '.txt');
          const payloadBytes = new TextEncoder().encode(content);
          await fs.writeFile(payloadPath, payloadBytes);
          const resultRef = ('file://' + path.resolve(payloadPath)) as NonEmpty;
          const resultDigest = sha256Hex(payloadBytes);

          const slotId = (node.expectedOutputSlots[0] ?? 'default') as NonEmpty;
          const outputRef = createNvgOutputReference({
            runId: request.runId,
            taskId: node.nodeId,
            agentId: node.agentId,
            slotId,
            resultRef,
            resultDigest,
            resultClassifications: [result.classification.effectiveDataClass],
            octLevel: agent.octLevel ?? 'OCT-OPEN',
            redactionState: 'not_required',
            // Trail correlation: NVG already wrote outbound + inbound entries
            // under this id; reuse it for cross-linking with the mailbox item.
            routingTrailRecordId: result.trailCorrelationId,
            trailCorrelationId: result.trailCorrelationId,
            modelTierInvoked: result.modelTierInvoked,
            responseSize: inv.responseSize ?? null,
          });

          const item = await br.externals.outputCollector.writeMailboxItemFromNvgResult(outputRef);
          console.log(
            '[output] mailbox item',
            item.mailboxItemId,
            'written for run:',
            request.runId
          );

          // CLAUDE-CODE-MODEL-SELECTION-SPEC §5 — record the preference vs.
          // the actually-used endpoint so the audit trail reveals when the
          // user's selection was honored, when a sibling on the same tier
          // ran instead, and when policy fallback fired. preferenceHonored
          // is null (rather than false) when the user supplied no preference
          // — that distinguishes "not asked" from "asked but unhonored".
          const actualEndpointId = inv.endpointUsed?.endpointId ?? null;
          const preferenceHonored: boolean | null =
            request.preferredEndpointId === null
              ? null
              : actualEndpointId === request.preferredEndpointId;

          return {
            success: true,
            completionMetadata: {
              mailboxItemId: item.mailboxItemId,
              modelTierInvoked: result.modelTierInvoked,
              responseSize: inv.responseSize ?? null,
              preferredEndpointId: request.preferredEndpointId,
              actualEndpointId,
              preferenceHonored,
            },
            failureReason: null,
            governanceDenied: false,
          };
        } catch (err) {
          console.error('[orch-wire] dispatchToGovernance error:', err);
          return {
            success: false,
            completionMetadata: null,
            failureReason: ('dispatch_error: ' + (err as Error).message) as NonEmpty,
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

          // Systems: strict intersection of agent's and principal's allowed
          // systems. No wildcards — both sides must list concrete connector IDs.
          // mintRootDelegation will reject any system not in principal scope, so
          // a bare '*' here would fail closed at signing time anyway.
          const effectiveSystems = agent.allowedSystems.filter(s =>
            principal.allowedSystems.includes(s)
          );

          // Capabilities: agent's capabilities pass through. The Principal type
          // has no allowedCapabilities field — capability scope is enforced at
          // Gate 03 (delegation) plus the OCT ceiling and risk-tier comparison.
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
    //
    // triggerCompile drives the §6.8 compile chain: build the OutputContract
    // from the run's mailbox state, call CompileService (selects mode, signs
    // FinalResponseArtifact), resolve the compile-return endpoint for the run,
    // dispatch via the signed-callback transport, and only mark mailbox items
    // consumed once the workspace has acknowledged acceptance.
    const triggerCompile = async (runId: Uuid): Promise<void> => {
      console.log('[compile] triggered for run:', runId);
      try {
        const contract = await br.externals.outputCollector.buildOutputContract(runId);
        const compiler = br.externals.socketRegistry.getDefaultCompiler();
        const mailbox = br.externals.socketRegistry.getPrimaryMailbox();
        const items = await br.externals.mailboxService.listEligibleForCompile(
          mailbox.mailboxId,
          runId
        );
        console.log(
          '[compile] mode-eligible items:',
          items.length,
          'compiler:',
          compiler.compilerSocketId
        );

        const compileRequest: CompileRequest = {
          runId,
          compilerSocketId: compiler.compilerSocketId,
          mailboxId: mailbox.mailboxId,
          outputContractId: contract.outputContractId,
          requestedAt: nowIso(),
        };
        const artifact = await br.externals.compileService.compile(compileRequest, contract, items);
        console.log(
          '[compile] artifact',
          artifact.artifactId,
          'signed (' + artifact.compileMode + '), dispatching return'
        );

        const endpoint = await br.externals.socketRegistry.resolveReturnEndpointForRun(runId);
        const sentAt = nowIso();
        const ack = await br.externals.compileReturnDispatcher.dispatch({
          runId,
          endpoint,
          artifact,
          sentAt,
        });

        if (ack.accepted) {
          await br.externals.mailboxService.markConsumed(
            mailbox.mailboxId,
            runId,
            items.map(i => i.mailboxItemId)
          );
          console.log('[compile] return accepted at', ack.acceptedAt, '— mailbox items consumed');
        } else {
          console.warn('[compile] return NOT accepted —', ack.reason ?? '<no reason>');
        }
      } catch (err) {
        console.error('[compile] triggerCompile error:', err);
        // Best-effort run_closed on compile failure (T7-F03 pattern).
        try {
          await coreDeps.runLedgerWriter!.writeEvent({
            runId,
            eventType: 'run_closed',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              closeReason: 'error',
              error: (err as Error).message,
            },
          });
        } catch {
          // swallow — original error already logged
        }
      }
    };
    // ── CHECKBACK-spec — Pre-flight + plan checkback ─────────────────────
    //
    // The orchestrator calls `sendPlanCheckback` for every dispatchable run
    // (planCheckbackDefault=true on the default reference orchestrator). This
    // closure runs a non-invoking routing preview against the user's selected
    // agent. If a healthy invocation path exists (primary OR fallback tier
    // healthy), it auto-approves. Otherwise it emits a `plan_checkback_required`
    // event onto the run's SSE stream, suspends the run on a Deferred keyed by
    // runId, and waits for the workspace UI to POST a decision through
    // /workspace/runs/:runId/checkback.
    //
    // Timeout: V1 default = 5 minutes. After that the run auto-denies and is
    // closed by the orchestrator's user-cancelled path (run-coordinator.ts).
    interface PendingCheckback {
      readonly resolve: (decision: boolean) => void;
      readonly timer: ReturnType<typeof setTimeout>;
      readonly expiresAt: number;
    }
    const pendingCheckbacks = new Map<Uuid, PendingCheckback>();
    const CHECKBACK_TIMEOUT_MS = 5 * 60_000;

    /**
     * Suspend the run on a Deferred keyed by runId; the workspace UI's
     * POST /workspace/runs/:runId/checkback wakes it via resolvePendingCheckback.
     * Times out after CHECKBACK_TIMEOUT_MS — auto-deny + plan_checkback_resolved.
     */
    const waitForCheckback = (runId: Uuid): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          const stillPending = pendingCheckbacks.get(runId);
          if (stillPending && stillPending.timer === timer) {
            pendingCheckbacks.delete(runId);
            void coreDeps.runLedgerWriter!.writeEvent({
              runId,
              eventType: 'plan_checkback_resolved',
              timestamp: nowIso(),
              actorId: null,
              detail: { decision: 'deny', reason: 'checkback_timeout' },
            });
            resolve(false);
          }
        }, CHECKBACK_TIMEOUT_MS);

        pendingCheckbacks.set(runId, {
          resolve,
          timer,
          expiresAt: Date.now() + CHECKBACK_TIMEOUT_MS,
        });
      });

    const makeSendPlanCheckback = (request: WorkspaceRunRequest) => {
      return async (preview: OrchestratorPlanPreview): Promise<boolean> => {
        try {
          const firstAgent = preview.selectedAgents[0];
          if (!firstAgent) {
            // No agent in plan — orchestrator's downstream path handles this.
            return true;
          }
          const agent = await coreDeps.actorRegistry.get(firstAgent.agentId);
          if (!agent) return true;

          const probe: NvgOutboundRequest = {
            requestId: crypto.randomUUID() as Uuid,
            runId: request.runId,
            actorId: firstAgent.agentId,
            octLevel: agent.octLevel ?? 'OCT-OPEN',
            environmentContext: agent.environment,
            taskIntent: firstAgent.taskSummary,
            payload: [{ role: 'user', content: request.prompt }],
            dataLabels: [],
            costPreference: 'standard',
            latencyPreference: 'standard',
            // CLAUDE-CODE-MODEL-SELECTION-SPEC §4 — pre-flight inspects the
            // user's preferred endpoint health alongside the policy tier so
            // the checkback message can name a concrete unavailable model.
            preferredEndpointId: request.preferredEndpointId,
          };

          const routing = await br.nvgService.previewRouting(probe);
          const prefName = routing.preferredEndpoint
            ? routing.preferredEndpoint.modelName + ' (' + routing.preferredEndpoint.tier + ')'
            : '<none>';
          console.log(
            '[orch-wire] pre-flight — primary:',
            routing.primaryTier ?? '<none>',
            routing.primaryHealthy ? '(healthy)' : '(unhealthy)',
            '| fallback:',
            routing.fallbackTier ?? '<none>',
            routing.fallbackHealthy ? '(healthy)' : '(unhealthy)',
            '| preferred:',
            prefName,
            routing.preferredEndpoint
              ? routing.preferredEndpointHealthy
                ? '(healthy)'
                : '(unhealthy)'
              : ''
          );

          // CLAUDE-CODE-MODEL-SELECTION-SPEC §4 — preference-aware pre-flight.
          // When the user picked a specific endpoint:
          //   - healthy + within ceiling → auto-approve (router will use it)
          //   - unhealthy but a sibling on same tier is healthy → auto-approve
          //     (router falls through to sibling silently per §3 case 1d).
          //     plan_checkback_resolved logs this as 'preference_unhealthy_sibling'
          //     so the audit trail captures the implicit substitution.
          //   - whole tier unhealthy → checkback with preference-named message.
          //   - outside-ceiling preferences are denied at NVG dispatch
          //     terminally; pre-flight surfaces them as a checkback so the
          //     user can pick a different model rather than discover the
          //     denial mid-run.
          if (routing.preferredEndpoint) {
            const pref = routing.preferredEndpoint;
            // Outside ceiling → unsalvageable, but the user should know why
            // — surface as checkback so they can pick within-ceiling.
            if (!routing.preferredCeilingAllowed) {
              const message =
                `Your selected model (${pref.modelName} on ${pref.tier}) is outside the ` +
                `tier ceiling allowed by your role. ` +
                (routing.alternativeEndpoint
                  ? `A within-ceiling alternative is available: ${routing.alternativeEndpoint.modelName} on ${routing.alternativeEndpoint.tier}.`
                  : 'No within-ceiling alternative is currently available.');
              console.log(
                '[orch-wire] checkback required (preference outside ceiling) — run:',
                preview.runId,
                '—',
                message
              );
              await coreDeps.runLedgerWriter!.writeEvent({
                runId: preview.runId,
                eventType: 'plan_checkback_required',
                timestamp: nowIso(),
                actorId: null,
                detail: {
                  planDigest: preview.planDigest,
                  primaryTier: routing.primaryTier,
                  primaryHealthy: routing.primaryHealthy,
                  fallbackTier: routing.fallbackTier,
                  fallbackHealthy: routing.fallbackHealthy,
                  alternativeTier: routing.alternativeTier,
                  alternativeEndpoint: routing.alternativeEndpoint,
                  preferredEndpoint: pref,
                  preferredEndpointHealthy: routing.preferredEndpointHealthy,
                  preferredCeilingAllowed: false,
                  reason: 'preference_outside_ceiling',
                  message,
                  requiresUserApproval: true,
                  expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
                },
              });
              return await waitForCheckback(preview.runId);
            }

            // Healthy preference → use it directly.
            if (routing.preferredEndpointHealthy) {
              return true;
            }

            // Unhealthy preference but healthy sibling on same tier exists →
            // silent fallback to sibling (no user prompt, just record it).
            if (routing.preferredTierHasHealthySibling) {
              await coreDeps.runLedgerWriter!.writeEvent({
                runId: preview.runId,
                eventType: 'plan_created',
                timestamp: nowIso(),
                actorId: null,
                detail: {
                  planDigest: preview.planDigest,
                  preferenceSubstitution: 'preference_unhealthy_sibling',
                  preferredEndpoint: pref,
                  note: `Preferred endpoint ${pref.endpointId} is unhealthy; a healthy sibling on tier ${pref.tier} will be used.`,
                },
              });
              return true;
            }

            // Whole preferred tier dead → checkback with preference message.
            const altName = routing.alternativeEndpoint
              ? routing.alternativeEndpoint.modelName +
                ' on ' +
                routing.alternativeEndpoint.endpointId
              : null;
            const message =
              `Your preferred model (${pref.modelName} on ${pref.tier}) is unavailable. ` +
              (altName
                ? `Alternative available: ${altName}.`
                : 'No alternative within your tier ceiling is currently available.');
            console.log(
              '[orch-wire] checkback required (preference unavailable) — run:',
              preview.runId,
              '—',
              message
            );
            await coreDeps.runLedgerWriter!.writeEvent({
              runId: preview.runId,
              eventType: 'plan_checkback_required',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                planDigest: preview.planDigest,
                primaryTier: routing.primaryTier,
                primaryHealthy: routing.primaryHealthy,
                fallbackTier: routing.fallbackTier,
                fallbackHealthy: routing.fallbackHealthy,
                alternativeTier: routing.alternativeTier,
                alternativeEndpoint: routing.alternativeEndpoint,
                preferredEndpoint: pref,
                preferredEndpointHealthy: false,
                preferredCeilingAllowed: true,
                reason: 'preference_unavailable',
                message,
                requiresUserApproval: true,
                expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
              },
            });
            return await waitForCheckback(preview.runId);
          }

          // No preference → existing policy-tier behavior. Auto-approve when
          // there's a healthy path; NVG's invocation chain resolves same-tier
          // retry / fallback transparently.
          if (routing.primaryHealthy || routing.fallbackHealthy) {
            return true;
          }

          // No healthy path on the policy-selected tiers. Surface the
          // alternative (if any) and ask the user.
          const alternativeName = routing.alternativeEndpoint
            ? routing.alternativeEndpoint.modelName +
              ' on ' +
              routing.alternativeEndpoint.endpointId
            : null;
          const message = routing.alternativeTier
            ? `Selected tier ${routing.primaryTier ?? 'unknown'} has no healthy endpoints. ` +
              `An alternative on tier ${routing.alternativeTier} is available` +
              (alternativeName ? ` (${alternativeName}).` : '.')
            : `No healthy endpoints available within your model-tier ceiling. ` +
              `(Selected tier: ${routing.primaryTier ?? 'unknown'}` +
              (routing.denialReason ? `, ${routing.denialReason}` : '') +
              ').';

          console.log('[orch-wire] checkback required — run:', preview.runId, '—', message);

          await coreDeps.runLedgerWriter!.writeEvent({
            runId: preview.runId,
            eventType: 'plan_checkback_required',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              planDigest: preview.planDigest,
              primaryTier: routing.primaryTier,
              primaryHealthy: routing.primaryHealthy,
              fallbackTier: routing.fallbackTier,
              fallbackHealthy: routing.fallbackHealthy,
              alternativeTier: routing.alternativeTier,
              alternativeEndpoint: routing.alternativeEndpoint,
              denialCode: routing.denialCode,
              denialReason: routing.denialReason,
              message,
              requiresUserApproval: true,
              expiresAtMs: Date.now() + CHECKBACK_TIMEOUT_MS,
            },
          });

          return await waitForCheckback(preview.runId);
        } catch (err) {
          console.error('[orch-wire] sendPlanCheckback error:', err);
          return false; // fail closed
        }
      };
    };

    /**
     * Resolver invoked by /workspace/runs/:runId/checkback. Returns true iff
     * a pending Deferred existed for this runId — used by the route to
     * differentiate 200 (resolved) from 404 (no pending checkback).
     */
    const resolvePendingCheckback = async (runId: Uuid, allow: boolean): Promise<boolean> => {
      const pending = pendingCheckbacks.get(runId);
      if (!pending) return false;
      pendingCheckbacks.delete(runId);
      clearTimeout(pending.timer);
      await coreDeps.runLedgerWriter!.writeEvent({
        runId,
        eventType: 'plan_checkback_resolved',
        timestamp: nowIso(),
        actorId: null,
        detail: { decision: allow ? 'allow' : 'deny' },
      });
      pending.resolve(allow);
      return true;
    };

    // Construction-time fallback so the RunCoordinatorDeps contract is
    // satisfied. The real per-run checkback is bound via perRunDeps below
    // (so the closure has the originating WorkspaceRunRequest).
    const sendPlanCheckback = async (_p: OrchestratorPlanPreview): Promise<boolean> => {
      throw new Error(
        '[orch-wire] handleRun called without per-run sendPlanCheckback — request prompt unknown'
      );
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
      // CLAUDE-CODE-MODEL-SELECTION-SPEC §2a — carry the user's preference
      // through the planner request so downstream node dispatch can pass it
      // on to NVG for biased endpoint selection.
      preferredEndpointId: request.preferredEndpointId,
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
        // Orchestrator capability ceiling = the canonical capability taxonomy
        // (§12.4). Wildcards are not accepted here — the planner's visibility
        // check requires concrete capability strings, and a wildcard placeholder
        // would silently filter every agent out. Adding a new capability to
        // CAPABILITY_IDS automatically widens the ceiling on the next boot.
        capabilityCeiling: Object.values(CAPABILITY_IDS) as NonEmpty[],
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
      // Build per-request issuer + dispatcher + checkback closing over the
      // requesting user's principalId AND the originating prompt — handleRun
      // threads them into every plan-node dispatch and the pre-flight probe.
      const issueDelegation = makeIssueDelegation(request.principalId);
      const dispatchToGovernance = makeDispatchToGovernance(request);
      const sendPlanCheckback = makeSendPlanCheckback(request);
      return coordinator.handleRun(request, {
        issueDelegation,
        dispatchToGovernance,
        sendPlanCheckback,
      });
    };

    // Compile-return helpers — bound here so the route can dispatch through the
    // same signed-callback transport that the engine uses, and the receiving
    // /compile-return/:returnEndpointId verifier can verify with the same key.
    const dispatchCompileReturn = async (input: {
      runId: Uuid;
      endpoint: CompileReturnEndpointRecord;
      artifact: FinalResponseArtifact;
      sentAt: IsoTimestamp;
    }): Promise<CompileReturnAck> => {
      return br.externals.compileReturnDispatcher.dispatch(input);
    };

    const verifyCallbackSignature = (
      request: CompileReturnRequest,
      publicKey: string
    ): Promise<boolean> => verifyCallbackAuth(request, publicKey);

    const verifyArtifactSignatureFn = (
      artifact: FinalResponseArtifact,
      publicKey: string
    ): Promise<boolean> => verifyArtifactSignature(artifact, publicKey);

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
      // CHECKBACK-spec — exposes the resolver so the workspace POST route can
      // wake the pending Deferred in sendPlanCheckback when the user replies.
      resolvePendingCheckback,
      // E2E wiring — services threaded so reference harness routes can call
      // the real engines, and the workspace flow can roundtrip a prompt
      // through NVG → mailbox → compile → return.
      nvgService: br.nvgService,
      mailboxService: br.externals.mailboxService,
      outputCollector: br.externals.outputCollector,
      compileService: br.externals.compileService,
      getDefaultCompiler: () => br.externals.socketRegistry.getDefaultCompiler(),
      getPrimaryMailbox: () => br.externals.socketRegistry.getPrimaryMailbox(),
      resolveReturnEndpointForRun: (runId: Uuid) =>
        br.externals.socketRegistry.resolveReturnEndpointForRun(runId),
      dispatchCompileReturn,
      // Compile-return route verification helpers — used by the receiving
      // /compile-return/:returnEndpointId handler to validate the signed
      // callback and the artifact before writing run_closed.
      getReturnEndpoint: (returnEndpointId: string) =>
        br.externals.socketRegistry.getReturnEndpoint(returnEndpointId as NonEmpty),
      verifyCallbackSignature,
      verifyArtifactSignature: verifyArtifactSignatureFn,
      recomputeArtifactDigest,
      controlPlanePublicKey: br.controlPlanePublicKey,
      // Body resolver for the compile-return route — reads the file:// URI
      // produced by DeterministicRenderer so `final_response` can carry the
      // rendered text inline. Strips the URI scheme; the path is whatever
      // the renderer wrote relative to cwd.
      resolveArtifactBody: async (ref: NonEmpty): Promise<string> => {
        const raw = String(ref);
        if (!raw.startsWith('file://')) {
          throw new Error('resolveArtifactBody: only file:// refs supported, got ' + raw);
        }
        const filePath = raw.slice('file://'.length);
        return fs.readFile(path.resolve(filePath), 'utf-8');
      },
      // CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — admin secret onboarding (write-only port).
      secretWriter,
    };
  },
});

// Filter out bare '--' that pnpm may inject between script path and subcommands.
const argv = process.argv.filter((arg, idx) => !(arg === '--' && idx === 2));
program.parse(argv);
