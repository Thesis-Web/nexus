/**
 * API Routes barrel — spec §6.1 (routes/ directory), §23.2
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
}
