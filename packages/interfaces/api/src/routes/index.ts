/**
 * API Routes barrel — spec §6.1 (routes/ directory), §23.2
 * AMEND-spec §11.2 — registers all route modules including reference harness.
 * AMEND-spec-nexus-compile §6 — registers template admin route.
 * AMEND-nexus-spec-workspace §5.1 — auth split (T16-F02).
 *
 * Auth split:
 *   /workspace/* → JWT auth (handled internally by workspace routes)
 *   /compile-return/* → callback signature (handled internally)
 *   /admin/*, legacy → admin bearer auth (via adminAuth middleware)
 *
 * Registration order per blueprint §2.2:
 *   1. Workspace routes (own JWT auth — login before middleware)
 *   2. Compile-return routes (own callback sig auth)
 *   3. Admin-authenticated routes (via Router with adminAuth)
 *
 * NOTE: Optional deps from ApiDependencies are conditionally spread into
 * route registration calls. With exactOptionalPropertyTypes: true,
 * reading an optional prop yields T | undefined, but writing
 * { prop: T | undefined } into { prop?: T } is illegal.
 * Conditional spread omits the key entirely when the value is undefined,
 * which satisfies the optional property contract.
 */
import type { Express, RequestHandler } from 'express';
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
  state: ApiSharedState,
  adminAuth: RequestHandler
): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // Self-authenticating routes — registered BEFORE adminAuth
  // ═══════════════════════════════════════════════════════════════════════════

  // Workspace routes — JWT auth handled internally [§5.1, GWS5-AUD-01]
  // Login route registered first, then /workspace/* JWT middleware, then routes.
  registerWorkspaceRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
    ...(deps.identityProvider !== undefined ? { identityProvider: deps.identityProvider } : {}),
    ...(deps.workspaceSockets !== undefined ? { workspaceSockets: deps.workspaceSockets } : {}),
    ...(deps.computeDigest !== undefined ? { computeDigest: deps.computeDigest } : {}),
    ...(deps.dispatchToOrchestrator !== undefined
      ? { dispatchToOrchestrator: deps.dispatchToOrchestrator }
      : {}),
    ...(deps.workspaceSessionStore !== undefined
      ? { workspaceSessionStore: deps.workspaceSessionStore }
      : {}),
    ...(deps.workspaceJwtSecret !== undefined
      ? { workspaceJwtSecret: deps.workspaceJwtSecret }
      : {}),
    ...(deps.workspaceRunAclStore !== undefined
      ? { workspaceRunAclStore: deps.workspaceRunAclStore }
      : {}),
  });

  // Compile-return routes — callback signature auth [§5.1]
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
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin-authenticated routes — path-scoped adminAuth bearer token [T16-F02]
  // ═══════════════════════════════════════════════════════════════════════════

  // Path-scoped admin auth — applies only to legacy + admin paths, not workspace/static
  const adminPaths = [
    '/actors',
    '/principals',
    '/sessions',
    '/delegations',
    '/policies',
    '/approvals',
    '/ledger',
    '/posture',
    '/run-ledger',
    '/modes',
    '/nvg',
    '/orchestrator',
    '/mailbox',
    '/compile',
    '/admin',
  ];
  for (const p of adminPaths) {
    app.use(p, adminAuth);
  }

  // Legacy routes
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

  // Reference harness routes — admin-authenticated
  registerOrchestratorRoutes(app, {
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
    ...(deps.orchestratorSockets !== undefined
      ? { orchestratorSockets: deps.orchestratorSockets }
      : {}),
    ...(deps.computeDigest !== undefined ? { computeDigest: deps.computeDigest } : {}),
    orchestrator: deps.orchestrator ?? null,
  });

  registerMailboxRoutes(app, {
    ...(deps.mailboxService !== undefined ? { mailboxService: deps.mailboxService } : {}),
    ...(deps.primaryMailbox !== undefined ? { primaryMailbox: deps.primaryMailbox } : {}),
  });

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

  // Template admin route — admin-authenticated
  registerTemplateRoutes(app, {
    ...(deps.validateTemplate !== undefined ? { validateTemplate: deps.validateTemplate } : {}),
    ...(deps.verifyTemplate !== undefined ? { verifyTemplate: deps.verifyTemplate } : {}),
    ...(deps.storeTemplate !== undefined ? { storeTemplate: deps.storeTemplate } : {}),
    ...(deps.templateExists !== undefined ? { templateExists: deps.templateExists } : {}),
    ...(deps.runLedgerWriter !== undefined ? { runLedgerWriter: deps.runLedgerWriter } : {}),
  });
}
