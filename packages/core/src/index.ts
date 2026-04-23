/**
 * @nexus/core — public barrel
 * Spec: nexus-engineering-spec-v1-8-26.md §12-§20
 */

// §12 — All contracts (includes utilities moved to contracts per DEF-001)
export * from './types/index.js';

// §15 — Crypto
export * from './crypto/canonicalize.js';
export * from './crypto/signer.js';
export * from './crypto/verifier.js';
export * from './crypto/key-manager.js';

// §20.1 — SQLite schema
export * from './db/schema.js';

// §17 — Security
export * from './security/replay-detector.js';
export * from './security/injection-guard.js';
export * from './security/rate-limiter.js';
export * from './security/threat-log.js';

// §20 — Identity registries
export { SqliteActorRegistry } from './identity/actor-registry.js';
export { SqlitePrincipalRegistry } from './identity/principal-registry.js';
export { SqliteApproverRegistry } from './identity/approver-registry.js';
export { SqliteSessionStore } from './identity/session-store.js';
export { SqliteDelegationStore, nextSequence } from './identity/delegation-store.js';
export { mintRootDelegation, mintSubDelegation } from './identity/delegation-engine.js';
export type { RootDelegationParams, SubDelegationParams } from './identity/delegation-engine.js';

// §13.3 — Classification
export { VerbNormalizer } from './classification/verb-normalizer.js';
export { LexicalVerbResolver } from './classification/lexical-verb-resolver.js';
export { TargetNormalizer } from './classification/target-normalizer.js';
export { CapabilityRegistry, resolveCapability } from './classification/capability-registry.js';
export type { CapabilityEntry } from './classification/capability-registry.js';
export { DataClassifier } from './classification/data-classifier.js';
export { RiskClassifier } from './classification/risk-classifier.js';

// §13.5 — Policy
export { matchesCondition } from './policy/evaluator.js';
export { loadPolicyFile, computePolicyBundleHash } from './policy/rule-loader.js';
export {
  buildGrantTemplate,
  templateFingerprintPayload,
  assertTemplateIntegrity,
} from './policy/grant-template-builder.js';

// §13.6 — Approval
export {
  buildSignedApprovalRequest,
  buildActionSummaryText,
  computeEstimatedImpact,
} from './approval/packager.js';
export { decideApproval } from './approval/decision-service.js';
export { SqlitePendingApprovalStore } from './approval/pending-approval-store.js';
export { CliApprovalChannel } from './approval/channels/cli.channel.js';

// §13.7 — Execution
export { mintGrant } from './execution/grant-minter.js';
export {
  setGrantSecret,
  getGrantSecret,
  clearGrantSecret,
  assertGrantPresent,
  assertGrantNotExpired,
  GrantVaultImpl,
  grantVault,
} from './execution/grant-vault.js';

// §18 — Redaction
export { redactExecutionResult } from './redaction/redactor.js';

// §14 — CCV
export { buildCCV } from './compiler-view/ccv-builder.js';

// §16 — Ledger
export { verifyChain } from './ledger/chain-verifier.js';
export { JsonlLedgerBackend } from './ledger/backends/jsonl.backend.js';

// §30 — Run Ledger (DEF-002)
export { JsonlRunLedgerWriter } from './ledger/run-ledger.js';

// §9 — Operating Modes (DEF-006)
export {
  loadModeConfig,
  saveModeConfig,
  changeMode,
  disableEnforcingLock,
  getInfraRunId,
  emitInfrastructureAuditEvent,
  loadAdminPublicKey,
  createDefaultModeConfig,
} from './modes/mode-manager.js';

// §10.4 — Ceiling Resolver
export {
  resolveEffectiveCeiling,
  riskTierMin,
  intersect,
} from './classification/ceiling-resolver.js';

// §11.3 — OCT Manager
export { assignOct } from './identity/oct-manager.js';

// §13.1 — Pipeline
export { Pipeline, SimpleConnectorRegistry, SimpleChannelRegistry } from './engine/pipeline.js';
export type { PipelineGates } from './engine/pipeline.js';

// §13.2-§13.8 — Gates
export { IdentityGate } from './gates/01-identity.gate.js';
export { ClassificationGate } from './gates/02-classification.gate.js';
export { DelegationGate } from './gates/03-delegation.gate.js';
export { PolicyGate } from './gates/04-policy.gate.js';
export { ApprovalGate } from './gates/05-approval.gate.js';
export { ExecutionGate } from './gates/06-execution.gate.js';
export { EvidenceGate } from './gates/07-evidence.gate.js';
