// packages/contracts/src/interfaces/index.ts
// Spec: nexus-engineering-spec-v1-7-25.md §12.3, §10.2, §14.1
// Layer 2 — all interface contracts. Imports from types and constants only.

import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty, SemVer } from '../types/index.js';

import type {
  ActorClass,
  ActionVerb,
  RiskTier,
  DataClass,
  EnvironmentId,
  ModelTier,
  OctLevel,
  OperatingMode,
  OutcomeLabel,
  ApprovalDecisionLabel,
  FinalOutcome,
  GateId,
  ExpiryClass,
  DenialCode,
  EvidenceSentinel,
  ScenarioId,
} from '../constants/index.js';

// ─── §12.3.1 Principal ───
export interface Principal {
  principalId: Uuid;
  displayName: NonEmpty;
  email: NonEmpty;
  registeredAt: IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems: string[];
}

// ─── §12.3.2 Actor ───
export interface Actor {
  actorId: Uuid;
  actorClass: ActorClass;
  principalId: Uuid;
  displayName: NonEmpty;
  environment: EnvironmentId;
  octLevel: OctLevel;
  riskCeiling: RiskTier;
  allowedSystems: string[];
  registeredAt: IsoTimestamp;
  owner?: NonEmpty;
  purpose?: NonEmpty;
  reviewCadence?: NonEmpty;
}

// ─── §12.3.3 DelegationContext ───
export interface DelegationContext {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  parentDelegationId: Uuid | null;
  chainDepth: number;
  maxChainDepth: number;
  allowedSystems: string[];
  allowedCapabilities: string[];
  forbiddenCapabilities: string[];
  maxRiskTier: RiskTier;
  allowDownstreamPropagation: boolean;
  environment: EnvironmentId;
  mintedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  mintedBy: NonEmpty;
  signature: Base64Url;
}

// ─── §12.3.4 Session ───
export interface Session {
  sessionId: Uuid;
  actorId: Uuid;
  principalId: Uuid;
  delegationId: Uuid;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.6 IntentContext ───
export interface IntentContext {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
  extractedAt: IsoTimestamp;
}

// ─── §12.3.8 ResourceTarget ───
export interface ResourceTarget {
  system: NonEmpty;
  resourceType: NonEmpty;
  resourceScope: 'single' | 'bulk' | 'collection' | 'system';
  environment: EnvironmentId;
  externalFacing: boolean;
}

// ─── §12.3.5 AgentAction ───
export interface AgentAction {
  actionId: Uuid;
  runId: Uuid;
  receivedAt: IsoTimestamp;
  protocol: NonEmpty;
  adapterVersion: NonEmpty;
  actorId: Uuid;
  principalId: Uuid;
  sessionId: Uuid;
  delegationId: Uuid;
  delegationSequence: number;
  tool: NonEmpty;
  rawVerb: NonEmpty;
  rawTarget: NonEmpty;
  rawPayload: unknown;
  intent: IntentContext;
  resolvedVerb: ActionVerb | null;
  resolvedCapability: string | null;
  resolvedTarget: ResourceTarget | null;
  resolvedDataClasses: DataClass[];
  resolvedRiskTier: RiskTier | null;
}

// ─── §12.3.7 GateDecision ───
export interface GateDecision {
  gateId: GateId;
  gateOrder: number;
  plane: 'control' | 'data';
  outcome: string;
  reason: NonEmpty;
  denialCode: DenialCode | null;
  policyRuleId: string | null;
  evaluatedAt: IsoTimestamp;
  durationMs: number;
  metadata: Record<string, string | number | boolean | null>;
}

// ─── §12.3.10 ResourceBounds ───
export interface ResourceBounds {
  allowedResourceTypes: string[];
  maxRecords: number | null;
  allowBulk: boolean;
  allowExternalFacing: boolean;
}

// ─── §12.3.27 PolicyCondition, GrantTemplateHint, ApprovalConfig, PolicyRule, LoadedPolicyFile ───
export interface PolicyCondition {
  actorClasses?: ActorClass[];
  capabilities?: string[];
  actionVerbs?: ActionVerb[];
  riskTiers?: RiskTier[];
  dataClasses?: DataClass[];
  environments?: EnvironmentId[];
  externalFacing?: boolean;
  maxChainDepth?: number;
}

export interface GrantTemplateHint {
  expiryClass?: ExpiryClass;
  maxRecords?: number;
  allowBulk?: boolean;
  allowExternalFacing?: boolean;
}

export interface ApprovalConfig {
  timeoutSeconds: number;
  channelId: NonEmpty;
}

export interface PolicyRule {
  ruleId: NonEmpty;
  priority: number;
  conditions: PolicyCondition;
  outcome: OutcomeLabel;
  grantHint?: GrantTemplateHint;
  approvalConfig?: ApprovalConfig;
}

export interface LoadedPolicyFile {
  filepath: NonEmpty;
  bundleHash: Sha256Hex;
  sortedRules: PolicyRule[];
  loadedAt: IsoTimestamp;
  signature: Base64Url;
}

// ─── §12.3.9 ExecutionGrantTemplate ───
export interface ExecutionGrantTemplate {
  templateId: Uuid;
  actionId: Uuid;
  computedAt: IsoTimestamp;
  capabilityId: string;
  scopeDescriptor: NonEmpty;
  credentialSubjectType: NonEmpty;
  resourceBounds: ResourceBounds;
  environmentBound: EnvironmentId;
  expiryClass: ExpiryClass;
  maxExpirySeconds: number;
  approvalRequired: boolean;
  approvalLinkage: Uuid | null;
  approvalConfig: ApprovalConfig | null;
  templateFingerprint: Sha256Hex;
}

// ─── §12.3.11 ApprovalRequest ───
export interface ApprovalRequest {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  actionSummary: NonEmpty;
  contextSummary: NonEmpty;
  proposedTarget: ResourceTarget;
  diff: string | null;
  estimatedImpact: NonEmpty;
  principalDisplayName: NonEmpty;
  actorDisplayName: NonEmpty;
  riskTier: RiskTier;
  dataClasses: DataClass[];
  modelConfidence: number | null;
  riskNote: string | null;
  signature: Base64Url;
}

// ─── §12.3.12 ApprovalResponse ───
export interface ApprovalResponse {
  approvalId: Uuid;
  decision: ApprovalDecisionLabel;
  decidedBy: NonEmpty;
  decidedAt: IsoTimestamp;
  channel: NonEmpty;
  note: string | null;
  signature: Base64Url;
}

// ─── §12.3.14 CredentialSubject ───
export interface CredentialSubject {
  subjectId: NonEmpty;
  subjectType: 'user_identity' | 'service_identity' | 'federated';
  system: NonEmpty;
}

// ─── §12.3.13 ExecutionGrant ───
export interface ExecutionGrant {
  grantId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  approvalId: Uuid | null;
  mintedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  capabilityId: string;
  scopeDescriptor: NonEmpty;
  credentialSubject: CredentialSubject;
  resourceBounds: ResourceBounds;
  environmentBound: EnvironmentId;
  signature: Base64Url;
  // secretValue: NOT on this interface. Lives in grant-vault WeakMap only.
}

// ─── §12.3.15 ExecutionResult ───
export interface ExecutionResult {
  grantId: Uuid;
  executedAt: IsoTimestamp;
  status: 'success' | 'failure' | 'partial';
  responseCode: string | null;
  durationMs: number;
  redactedSummary: string | null;
  errorType: string | null;
  errorMessage: string | null;
}

// ─── §12.3.16 ExecutionGrantMetadata (evidence-safe, no secret) ───
export interface ExecutionGrantMetadata {
  grantId: Uuid | EvidenceSentinel;
  scopeDescriptor: NonEmpty | EvidenceSentinel;
  credentialSubjectId: NonEmpty | EvidenceSentinel;
  credentialSubjectType: string | EvidenceSentinel;
  issuedAt: IsoTimestamp | EvidenceSentinel;
  expiresAt: IsoTimestamp | EvidenceSentinel;
  expiryClass: ExpiryClass | EvidenceSentinel;
  templateFingerprint: Sha256Hex | EvidenceSentinel;
  approvalLinkage: Uuid | EvidenceSentinel;
}

// ─── §12.3.17 DelegationContextSnapshot ───
export interface DelegationContextSnapshot {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  chainDepth: number;
  chainAncestors: Uuid[];
  chainHash: Sha256Hex;
  allowedSystems: string[];
  maxRiskTier: RiskTier;
  environment: EnvironmentId;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.18 ThreatEvent ───
export type ThreatType =
  | 'replay_detected'
  | 'injection_truncated'
  | 'broad_token_bypass'
  | 'scope_expansion_attempt'
  | 'policy_signature_invalid'
  | 'approval_response_invalid'
  | 'rate_limit_exceeded'
  | 'intent_overflow'
  | 'environment_mismatch'
  | 'security_violation'
  | 'nvg_wall_violation';

export interface ThreatEvent {
  threatType: ThreatType;
  detectedAt: IsoTimestamp;
  gateId: GateId | 'ingress' | 'nvg';
  detail: NonEmpty;
}

// ─── §12.3.19 IntentEvidence ───
export interface IntentEvidence {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
}

// ─── §14.1 CompilerComparisonView ───
export interface CompilerComparisonView {
  meta: {
    blueprintVersion: SemVer;
    runtimeContractVersion: SemVer;
    capabilityTaxonomyVersion: SemVer;
    comparisonInputVersion: SemVer;
    normalizedActionHash: Sha256Hex;
    policyBundleHash: Sha256Hex;
  };
  identity: {
    actorId: Uuid;
    actorClass: ActorClass;
    principalId: Uuid;
    environment: EnvironmentId;
  };
  delegation: {
    delegationContextId: Uuid;
    chainDepth: number;
    chainHash: Sha256Hex;
    maxRiskTier: RiskTier;
  };
  classification: {
    capabilityId: string | EvidenceSentinel;
    actionVerb: ActionVerb | EvidenceSentinel;
    dataClasses: DataClass[] | EvidenceSentinel;
    riskTier: RiskTier | EvidenceSentinel;
  };
  policyAndApproval: {
    policyRuleId: string | EvidenceSentinel;
    outcomeLabel: OutcomeLabel | EvidenceSentinel;
    approvalRequired: boolean | EvidenceSentinel;
    approvalDecisionLabel: ApprovalDecisionLabel | EvidenceSentinel;
  };
  authorityAndExecution: {
    executionGrantId: Uuid | EvidenceSentinel;
    credentialSubjectType: string | EvidenceSentinel;
    scopeDescriptor: string | EvidenceSentinel;
    expiryClass: ExpiryClass | EvidenceSentinel;
    grantTemplateFingerprint: Sha256Hex | EvidenceSentinel;
  };
  result: {
    finalOutcome: FinalOutcome;
    errorCodeFamily: string | null;
  };
}

// ─── §12.3.20 EvidenceRecord ───
export interface EvidenceRecord {
  recordId: Uuid;
  actionId: Uuid;
  sessionId: Uuid;
  runId: Uuid;
  ledgerSequence: number;
  actionSummary: {
    actionId: Uuid;
    receivedAt: IsoTimestamp;
    protocol: string;
    actorId: Uuid;
    actorClass: ActorClass;
    actorEnvironment: EnvironmentId;
    principalId: Uuid;
    delegationSequence: number;
    tool: string;
    resolvedVerb: ActionVerb | EvidenceSentinel;
    resolvedCapability: string | EvidenceSentinel;
    resolvedTarget: ResourceTarget | EvidenceSentinel;
    resolvedDataClasses: DataClass[] | EvidenceSentinel;
    resolvedRiskTier: RiskTier | EvidenceSentinel;
  };
  intentEvidence: IntentEvidence;
  delegationContextSnapshot: DelegationContextSnapshot;
  gateDecisions: GateDecision[];
  policyRuleId: string | EvidenceSentinel;
  policyOutcome: OutcomeLabel | EvidenceSentinel;
  approvalRequired: boolean | EvidenceSentinel;
  approvalRequest: ApprovalRequest | null;
  approvalResponse: ApprovalResponse | null;
  approvalDecisionLabel: ApprovalDecisionLabel | EvidenceSentinel;
  grantMetadata: ExecutionGrantMetadata;
  executionResult: ExecutionResult | null;
  finalOutcome: FinalOutcome;
  threatEvents: ThreatEvent[];
  compilerView: CompilerComparisonView;
  previousHash: Sha256Hex;
  recordHash: Sha256Hex;
  signature: Base64Url;
}

// ─── §12.3.21 Gate Interface ───
export interface Gate {
  readonly gateId: GateId;
  readonly gateOrder: number;
  readonly plane: 'control' | 'data';
  evaluate(
    action: AgentAction,
    context: PipelineContext,
    priorDecisions: GateDecision[]
  ): Promise<GateResult>;
  onDownstreamFailure?(action: AgentAction, failedGate: GateId): Promise<void>;
}

// ─── §12.3.22 GateResult ───
export interface GateResult {
  decision: GateDecision;
  actionMutations?: Partial<AgentAction>;
  grantTemplate?: ExecutionGrantTemplate;
  grant?: ExecutionGrant;
  executionResult?: ExecutionResult;
  delegationSnapshot?: DelegationContextSnapshot;
  approvalRequest?: ApprovalRequest;
  approvalResponse?: ApprovalResponse;
}

// ─── §12.3.23 PipelineContext ───
export interface PipelineContext {
  sessionId: Uuid;
  delegationContext: DelegationContext;
  delegationStore: DelegationStore;
  delegationSnapshot?: DelegationContextSnapshot;
  actor: Actor;
  principal: Principal;
  policyFile: LoadedPolicyFile | null;
  approverRegistry: ApproverRegistry;
  connectorRegistry: ConnectorRegistry;
  channelRegistry: ChannelRegistry;
  threatLog: ThreatEvent[];
  startedAt: IsoTimestamp;
  grantTemplate?: ExecutionGrantTemplate;
  executionGrant?: ExecutionGrant;
  executionResult?: ExecutionResult;
  approvalRequest?: ApprovalRequest;
  approvalResponse?: ApprovalResponse;
  lastEvidenceRecord?: EvidenceRecord;
}

// ─── §12.3.24 LedgerBackend Interface ───
export interface LedgerBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  append(record: EvidenceRecord): Promise<void>;
  getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null>;
  getBySequence(seq: number): Promise<EvidenceRecord | null>;
  getLatestSequence(): Promise<number>;
  listRange(from: number, to: number): Promise<EvidenceRecord[]>;
}

// ─── §12.3.25 Connector Interface ───
export interface Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion: NonEmpty;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant): Promise<void>;
}

// ─── §12.3.26 ApprovalChannel Interface ───
export interface ApprovalChannel {
  readonly channelId: NonEmpty;
  readonly channelVersion: NonEmpty;
  dispatch(request: ApprovalRequest): Promise<void>;
  awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null>;
}

// ─── §12.3.28 PendingApprovalRecord ───
export interface PendingApprovalRecord {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  requestJson: string;
  channelId: NonEmpty;
  dispatchedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.29 DelegationStore Interface ───
export interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}

// ─── §12.3.30 Registry Interfaces ───
export interface ActorRegistry {
  get(actorId: Uuid): Promise<Actor | null>;
  register(actor: Actor): Promise<void>;
  updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void>;
  list(): Promise<Actor[]>;
}

export interface PrincipalRegistry {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
}

export interface ApproverRegistry {
  getPublicKey(approverId: NonEmpty): Promise<Base64Url | null>;
  register(actorId: Uuid, publicKey: Base64Url, channels: string[]): Promise<void>;
}

export interface ConnectorRegistry {
  get(systemType: NonEmpty): Connector | undefined;
  register(connector: Connector): void;
}

export interface ChannelRegistry {
  get(channelId: NonEmpty): ApprovalChannel | undefined;
  register(channel: ApprovalChannel): void;
}

// ─── §20.4 SessionStore Interface ───
export interface SessionStoreInterface {
  get(sessionId: Uuid): Promise<Session | null>;
  create(session: Session): Promise<void>;
  invalidate(sessionId: Uuid): Promise<void>;
}

// ─── §12.3.31 RunOptions and IngestEntry ───
export interface RunOptions {
  scenario?: ScenarioId;
  fixturesAll?: boolean;
  outDir?: string;
}

export interface IngestEntry {
  actionId: Uuid;
  receivedAt: IsoTimestamp;
  protocol: NonEmpty;
  actorId: Uuid;
  tool: NonEmpty;
  rawVerb: NonEmpty;
  rawTarget: NonEmpty;
  ingressResult: 'ok' | 'replay' | 'rate_limited' | 'injection_truncated';
  scenarioId: string;
}

// ─── §12.3.32 TokenPostureReport ───
export interface TokenPostureReport {
  generatedAt: IsoTimestamp;
  runId: string;
  actors: ActorPosture[];
  grantPatterns: GrantPatternSummary[];
  violations: PostureViolation[];
}

export interface ActorPosture {
  actorId: Uuid;
  actorClass: ActorClass;
  owner: string | null;
  environment: EnvironmentId;
  grantCount: number;
  maxRiskSeen: RiskTier;
  hasOwner: boolean;
}

export interface GrantPatternSummary {
  capabilityId: string;
  count: number;
  expiryClasses: ExpiryClass[];
  externalFacing: boolean;
  approvalRequired: boolean;
}

export interface PostureViolation {
  type: 'unowned_non_human_actor' | 'broad_scope_detected' | 'missing_review_cadence';
  detail: string;
  actorId: Uuid;
}

// ─── §12.3.33 CompileConfig ───
export interface CompileConfig {
  preferFrontierSynthesis: boolean;
}

// ─── §12.3.34 CrossLinkValidationResult ───
export interface CrossLinkValidationResult {
  ok: boolean;
  errors: string[];
}

// ─── §12.3.35 ChainVerificationResult ───
export interface ChainVerificationResult {
  ok: boolean;
  checkedFrom: number;
  checkedTo: number;
  recordCount: number;
  errors: ChainError[];
}

export interface ChainError {
  seq: number;
  type: 'hash_chain_break' | 'signature_invalid' | 'sequence_anomaly';
  denialCode: DenialCode;
  detail: string;
}

// ─── §12.3.36 Error Classes ───
export class ApprovalDecisionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class DelegationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class DelegationChainIntegrityError extends Error {
  constructor(missingId: Uuid) {
    super(`Delegation chain broken: parent ${missingId} not found in store`);
  }
}

// ─── §10.2 Identity Provider Interface ───
export interface IdentityClaims {
  principalIdentity: NonEmpty;
  roleAssignments: NonEmpty[];
  capabilityCeilings: CapabilityCeiling[];
  environmentContext: EnvironmentId;
  actorClass: ActorClass;
}

export interface CapabilityCeiling {
  allowedSystems: string[];
  allowedCapabilities: string[];
  maxRiskTier: RiskTier;
}

export interface AuthCredentials {
  type: 'api_key' | 'jwt' | 'oauth_token';
  value: NonEmpty;
}

export interface IdentityProviderInterface {
  readonly providerType: 'enterprise_iam' | 'enterprise_rbac' | 'reference_adapter';
  readonly providerVersion: NonEmpty;
  resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null>;
  authenticate(credentials: AuthCredentials): Promise<NonEmpty>;
}

// ─── §11.2 OCT Ceilings ───
export interface DelegationCeilingDescriptor {
  maxChainDepth: number;
  maxRiskTier: RiskTier | EvidenceSentinel;
}

export interface OctCeiling {
  dataClassCeiling: DataClass[];
  modelTierCeiling: ModelTier[];
  actionRiskCeiling: RiskTier | EvidenceSentinel;
  allowedSystems: string[];
  allowedCapabilities: string[];
  delegationCeiling: DelegationCeilingDescriptor;
}

export interface EffectiveCeiling {
  maxRiskTier: RiskTier;
  allowedSystems: string[];
  allowedCapabilities: string[];
  modelTierCeiling: ModelTier[];
}

// ─── §9.2 ModeConfiguration ───
export interface ModeConfiguration {
  nxsMode: OperatingMode;
  nvgMode: OperatingMode;
  enforcingLocked: boolean;
  updatedAt: IsoTimestamp;
  updatedBy: { adminId: NonEmpty; publicKey: Base64Url };
  signature: Base64Url;
}

// ─── §30 RunLedger types ───
export type RunEventType =
  | 'run_opened'
  | 'orchestrator_dispatched'
  | 'delegation_issued'
  | 'nvg_outbound'
  | 'nvg_inbound'
  | 'nvg_denied'
  | 'nxs_action'
  | 'partial_result'
  | 'compile_started'
  | 'compile_mode_selected'
  | 'final_response'
  | 'run_closed'
  | 'oct_assignment'
  | 'mode_change'
  | 'enforcing_lock_disabled'
  | 'bypass_annotation';

export interface RunLedgerEntry {
  entryId: Uuid;
  runId: Uuid;
  eventType: RunEventType;
  timestamp: IsoTimestamp;
  actorId: Uuid | null;
  detail: Record<string, unknown>;
}

export interface RunLedgerWriter {
  writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void>;
  getByRunId(runId: Uuid): Promise<RunLedgerEntry[]>;
  tail(n: number): Promise<RunLedgerEntry[]>;
  getLatestRunId(): Promise<Uuid | null>;
}

// ─── NexusSecurityViolation (§12.3.25 — connector contract) ───
export class NexusSecurityViolation extends Error {
  public readonly denialCode: DenialCode;
  constructor(denialCode: DenialCode, message: string) {
    super(message);
    this.denialCode = denialCode;
  }
}

// ─── Classification sub-component interfaces (§13.3) ───
export interface VerbNormalizer {
  normalize(rawVerb: string): ActionVerb | null;
}

export interface TargetNormalizer {
  normalize(
    rawTarget: string,
    tool: string,
    actorEnvironment: EnvironmentId
  ): ResourceTarget | null;
}

export interface DataClassifier {
  classify(intent: IntentContext, target: ResourceTarget, verb: ActionVerb): DataClass[];
}
