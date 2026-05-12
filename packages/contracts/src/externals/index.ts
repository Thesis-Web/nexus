// packages/contracts/src/externals/index.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3 — Externals Barrel
// AMEND-spec-nexus-orch §4.5 — Barrel Extensions
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — dashboard-setup additions (Claude C).
// Layer 2 — public compatibility surface for external plugin contracts.
//
// All plugin-facing contracts are exported here. Baked service interfaces
// (MailboxService, CompileService) are exported as types for DI composition
// but are NOT replaceable plugin surfaces — see individual files for law.

export type { WorkspaceRunRequest, CompileReturnAck, WorkspaceAdapter } from './workspace.js';

export type {
  OrchestratorSelectedAgent,
  OrchestratorPlanPreview,
  Orchestrator,
} from './orchestrator.js';

export type {
  OutputSourceType,
  BaseOutputReference,
  NvgOutputReference,
  NxsOutputReference,
  AgentPartialOutputReference,
} from './output-references.js';

export type {
  MailboxStatus,
  RedactionState,
  MailboxItem,
  MailboxWriteInput,
  MailboxReadQuery,
  MailboxBackend,
  MailboxService,
} from './mailbox.js';

export type { CompileEligibility, OutputContract, OutputCollector } from './output-contract.js';

export type {
  CompileMode,
  CompileRequest,
  FinalResponseArtifact,
  Compiler,
  CompileService,
} from './compiler.js';

export type {
  CompileFormat,
  DenialHandling,
  ContentGranularity,
  EntityRegistryName,
  SlotTypeName,
  SlotType,
  CompileLocation,
  CompileSection,
  GuardCondition,
  GuardAction,
  CompileGuard,
  CompileTemplate,
  CompilePreferences,
  AgentTaskSummary,
  ContractDesigner,
} from './compile-template.js';

export type {
  CompileReturnAuthEnvelope,
  CompileReturnRequest,
  CompileReturnVerifier,
  CompileReturnTransport,
} from './compile-return.js';

export type {
  OutputSlotPolicy,
  IdentityProviderManifestRecord,
  ConnectorManifestRecord,
  ChannelManifestRecord,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerArtifactSigning,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
} from './manifests.js';

export type {
  WorkspaceFactory,
  OrchestratorFactory,
  PlannerFactory,
  MailboxBackendFactory,
  CompilerFactory,
  CompileReturnTransportFactory,
} from './factories.js';

export type { PayloadResolver, PayloadStore } from './payload.js';

export type {
  WorkspaceFactoryRegistry,
  OrchestratorFactoryRegistry,
  PlannerFactoryRegistry,
  MailboxBackendFactoryRegistry,
  CompilerFactoryRegistry,
  CompileReturnTransportFactoryRegistry,
} from './factory-registries.js';

// ── AMEND-spec-nexus-orch §4.5 — planner.ts exports ──

export type {
  PromptVisibilityTier,
  AgentCapabilityEntry,
  AgentRegistryReader,
  NormalPlannerRequest,
  MetadataPlannerRequest,
  OctSecurePlannerRequest,
  PlannerRequest,
  EdgeHint,
  SubTaskDecl,
  NvgSubTask,
  NxsSubTask,
  SecureHandoffSubTask,
  SubTaskEdgeHint,
  PlannerContext,
  Planner,
} from './planner.js';

// ── AMEND-spec-nexus-orch §4.5 — execution-plan.ts exports ──

export type {
  PlanNode,
  PlanEdgeType,
  PlanConditionOperator,
  PlanCondition,
  PlanEdge,
  ExecutionPlan,
  PlanRejectionReason,
  PlanRejection,
  SuggestedAgent,
  NodeStatusType,
  NodeStatus,
  NodeDelegationBinding,
  RunDagState,
  SlotReadRef,
  NxsActionTemplate,
  NxsSlotBinding,
} from './execution-plan.js';

// ── AMEND-nexus-mailbox-pit-v0-2-1 §3.1 — MailboxAllocation ──

export type { MailboxAllocation } from './mailbox.js';

// ── AMEND-nexus-spec-workspace §1.4 — workspace-governed.ts exports ──

export type {
  OutputFormat,
  WorkspaceSession,
  CatalogItem,
  TemplateSectionConfig,
  ConstrainedFieldDef,
  TemplateSignature,
  RailSignature,
  ModelPreference,
  WorkspaceFileReference,
  FreeTextPromptInput,
  SectionedPromptInput,
  SecureRailsPromptInput,
  WorkspacePromptInput,
  WorkspaceRunEnvelope,
  ElevatedAuthMethod,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  ElevatedSessionStatus,
  ElevatedAuthProvider,
  WorkspaceApprovalBridge,
  WorkspaceUiEventKind,
  WorkspaceUiEvent,
  PromptTemplate,
  SecureRail,
  RunAcl,
  WorkspaceEventTicket,
  WorkspaceFileStorePort,
  WorkspaceBlobStorePort,
  WorkspaceRunAclStorePort,
  WorkspaceEventTicketStorePort,
  WorkspaceSessionStorePort,
  PromptTemplateStorePort,
  SecureRailStorePort,
  WorkspaceCatalogReaderPort,
  AdminSignerRegistry,
} from './workspace-governed.js';

export { OUTPUT_FORMAT_VALUES, ELEVATED_AUTH_METHOD } from './workspace-governed.js';

// ── SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — dashboard projection types ──
//
// Pinned by Claude C so backend (admin-setup routes) and frontend
// (admin panels + role gating) reference one source.

export type {
  DashboardReadinessState,
  DashboardSurfaceCategory,
  DashboardSecretFieldStatus,
  DashboardSecretField,
  DashboardEvidenceEntry,
  DashboardAllowedAction,
  DashboardSurfaceStatus,
  DashboardModeSummary,
  DashboardSetupStatusResponse,
} from './dashboard-setup.js';

export {
  ALL_READINESS_STATES,
  ALL_SURFACE_CATEGORIES,
  ADMIN_ROLE,
  ADMIN_ROLE_LOCAL_ALIAS,
  ADMIN_DISPLAY_LABEL,
  hasAdminRole,
  hasDashboardViewCapability,
} from './dashboard-setup.js';
