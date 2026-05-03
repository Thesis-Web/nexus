/**
 * API Routes barrel — spec §6.1 (routes/ directory), §23.2
 * AMEND-spec §11.2 — registers all route modules including reference harness.
 * AMEND-spec-nexus-compile §6 — registers template admin route.
 * Registers all route modules on the Express app.
 * Layer 7 — imports @nexus/contracts ONLY.
 *
 * NOTE: Optional deps from ApiDependencies are conditionally spread into
 * route registration calls. With exactOptionalPropertyTypes: true,
 * reading an optional prop yields T | undefined, but writing
 * { prop: T | undefined } into { prop?: T } is illegal.
 * Conditional spread omits the key entirely when the value is undefined,
 * which satisfies the optional property contract.
 */
import type { Express } from 'express';
import type { ApiDependencies } from '../server.js';
import type { ApiSharedState } from './shared.js';

import { registerPrincipalRoutes } from './principals.js';
import { registerActorRoutes } from './actors.js';
import { registerSessionRoutes } from './sessions.js';
import { registerDelegationRoutes } from './delegations.js';
import { registerPolicyRoutes } from './policies.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerLedgerRoutes } from './ledger.js';
import { registerPostureRoutes } from './posture.js';
import { registerRunLedgerRoutes } from './run-ledger.js';
import { registerModeRoutes } from './modes.js';
import { registerNvgRoutes } from './nvg.js';
import { registerWorkspaceRoutes } from './workspace.js';
import { registerOrchestratorRoutes } from './orchestrator.js';
import { registerMailboxRoutes } from './mailbox.js';
import { registerCompileRoutes } from './compile.js';
import { registerCompileReturnRoutes } from './compile-return.js';
import { registerTemplateRoutes } from './templates.js';

export function registerAllRoutes(
  app: Express,
  deps: ApiDependencies,
  state: ApiSharedState
): void {
  registerPrincipalRoutes(app, { principalRegistry: deps.principalRegistry });
  registerActorRoutes(app, { actorRegistry: deps.actorRegistry });
  registerSessionRoutes(app, {
    actorRegistry: deps.actorRegistry,
    sessionStore: deps.sessionStore,
    delegationStore: deps.delegationStore,
  });
  registerDelegationRoutes(app, {
    actorRegistry: deps.actorRegistry,
    principalRegistry: deps.principalRegistry,
    delegationStore: deps.delegationStore,
    mintRootDelegation: deps.mintRootDelegation,
  });
  registerPolicyRoutes(app, { loadPolicyFile: deps.loadPolicyFile }, state);
  registerApprovalRoutes(app, {
    approvalStore: deps.approvalStore,
    decideApproval: deps.decideApproval,
  });
  registerLedgerRoutes(app, {
    ledgerBackend: deps.ledgerBackend,
    verifyChain: deps.verifyChain,
  });
  registerPostureRoutes(app, { actorRegistry: deps.actorRegistry });

  // Optional deps: conditional spread to satisfy exactOptionalPropertyTypes
  registerRunLedgerRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
  });

  registerModeRoutes(app, {
    ...(deps.loadModeConfig !== undefined ? { loadModeConfig: deps.loadModeConfig } : {}),
    ...(deps.saveModeConfig !== undefined ? { saveModeConfig: deps.saveModeConfig } : {}),
  });

  registerNvgRoutes(app, {
    ...(deps.nvgService !== undefined ? { nvgService: deps.nvgService } : {}),
    ...(deps.trailReader !== undefined ? { trailReader: deps.trailReader } : {}),
    ...(deps.loadNvgRoutingPolicy !== undefined
      ? { loadNvgRoutingPolicy: deps.loadNvgRoutingPolicy }
      : {}),
  });

  // ── EXT-12: Reference harness routes — AMEND-spec §11.2 ──────────────────

  // Workspace reference harness — §6.2
  registerWorkspaceRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
    ...(deps.identityProvider !== undefined ? { identityProvider: deps.identityProvider } : {}),
    ...(deps.workspaceSockets !== undefined ? { workspaceSockets: deps.workspaceSockets } : {}),
    ...(deps.computeDigest !== undefined ? { computeDigest: deps.computeDigest } : {}),
    ...(deps.dispatchToOrchestrator !== undefined
      ? { dispatchToOrchestrator: deps.dispatchToOrchestrator }
      : {}),
  });

  // Orchestrator reference harness — §6.3
  registerOrchestratorRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
    ...(deps.orchestratorSockets !== undefined
      ? { orchestratorSockets: deps.orchestratorSockets }
      : {}),
    ...(deps.computeDigest !== undefined ? { computeDigest: deps.computeDigest } : {}),
    orchestrator: deps.orchestrator ?? null,
  });

  // Mailbox reference harness — §11.2
  registerMailboxRoutes(app, {
    ...(deps.mailboxService !== undefined ? { mailboxService: deps.mailboxService } : {}),
    ...(deps.primaryMailbox !== undefined ? { primaryMailbox: deps.primaryMailbox } : {}),
  });

  // Compile reference harness — §6.8
  registerCompileRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
    ...(deps.outputCollector !== undefined ? { outputCollector: deps.outputCollector } : {}),
    ...(deps.mailboxService !== undefined ? { mailboxService: deps.mailboxService } : {}),
    ...(deps.compileService !== undefined ? { compileService: deps.compileService } : {}),
    ...(deps.getDefaultCompiler !== undefined
      ? { getDefaultCompiler: deps.getDefaultCompiler }
      : {}),
    ...(deps.getPrimaryMailbox !== undefined ? { getPrimaryMailbox: deps.getPrimaryMailbox } : {}),
    ...(deps.resolveReturnEndpointForRun !== undefined
      ? { resolveReturnEndpointForRun: deps.resolveReturnEndpointForRun }
      : {}),
    ...(deps.dispatchCompileReturn !== undefined
      ? { dispatchCompileReturn: deps.dispatchCompileReturn }
      : {}),
  });

  // Compile-return reference harness — §6.9 (EXT-10, wired here)
  registerCompileReturnRoutes(app, {
    ...(deps.getReturnEndpoint !== undefined ? { getReturnEndpoint: deps.getReturnEndpoint } : {}),
    ...(deps.verifyCallbackSignature !== undefined
      ? { verifyCallbackSignature: deps.verifyCallbackSignature }
      : {}),
    ...(deps.verifyArtifactSignature !== undefined
      ? { verifyArtifactSignature: deps.verifyArtifactSignature }
      : {}),
    ...(deps.recomputeArtifactDigest !== undefined
      ? { recomputeArtifactDigest: deps.recomputeArtifactDigest }
      : {}),
    ...(deps.controlPlanePublicKey !== undefined
      ? { controlPlanePublicKey: deps.controlPlanePublicKey }
      : {}),
    // runLedgerWriter already spread above — reuse for compile-return
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
  });

  // Template admin route — AMEND-spec-nexus-compile §6
  registerTemplateRoutes(app, {
    ...(deps.validateTemplate !== undefined ? { validateTemplate: deps.validateTemplate } : {}),
    ...(deps.verifyTemplate !== undefined ? { verifyTemplate: deps.verifyTemplate } : {}),
    ...(deps.storeTemplate !== undefined ? { storeTemplate: deps.storeTemplate } : {}),
    ...(deps.templateExists !== undefined ? { templateExists: deps.templateExists } : {}),
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
  });
}
