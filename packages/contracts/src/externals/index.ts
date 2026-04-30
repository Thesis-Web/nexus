// packages/contracts/src/externals/index.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3 — Externals Barrel
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
  CompileReturnAuthEnvelope,
  CompileReturnRequest,
  CompileReturnVerifier,
  CompileReturnTransport,
} from './compile-return.js';

export type {
  OutputSlotPolicy,
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
  MailboxBackendFactory,
  CompilerFactory,
  CompileReturnTransportFactory,
} from './factories.js';

export type { PayloadResolver, PayloadStore } from './payload.js';

export type {
  WorkspaceFactoryRegistry,
  OrchestratorFactoryRegistry,
  MailboxBackendFactoryRegistry,
  CompilerFactoryRegistry,
  CompileReturnTransportFactoryRegistry,
} from './factory-registries.js';
