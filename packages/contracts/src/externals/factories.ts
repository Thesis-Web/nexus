// packages/contracts/src/externals/factories.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.13 — Factory Contracts
// AMEND-spec-nexus-orch §4.3 — PlannerFactory
// Layer 2 — factory contracts are the breaker slots.
//
// Manifests select a type discriminator; bootstrap factory registries resolve
// that discriminator to a known factory. YAML never executes arbitrary code.
//
// Factory law:
// - Factory registries are populated in bootstrap Step 01 before manifest loading.
// - Every enabled manifest entry discriminator must resolve in its domain
//   factory registry.
// - Missing factory resolution fails closed before API traffic starts.
// - Factories may instantiate adapters/transports/backends only for approved
//   local implementation identifiers already registered in code.
// - Manifest YAML must not carry executable import paths or arbitrary package code.

import type { NonEmpty } from '../types/index.js';
import type { WorkspaceAdapter } from './workspace.js';
import type { Orchestrator } from './orchestrator.js';
import type { Planner } from './planner.js';
import type { MailboxBackend } from './mailbox.js';
import type { Compiler } from './compiler.js';
import type { CompileReturnTransport } from './compile-return.js';
import type {
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
} from './manifests.js';

// ─── WorkspaceFactory ───

export interface WorkspaceFactory {
  readonly workspaceType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: WorkspaceManifestRecord): Promise<WorkspaceAdapter>;
}

// ─── OrchestratorFactory ───

export interface OrchestratorFactory {
  readonly orchestratorType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: OrchestratorManifestRecord): Promise<Orchestrator>;
}

// ─── PlannerFactory ── [AMEND-spec-nexus-orch §4.3]

export interface PlannerFactory {
  readonly plannerType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: OrchestratorManifestRecord): Promise<Planner>;
}

// ─── MailboxBackendFactory ───

export interface MailboxBackendFactory {
  readonly mailboxType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: MailboxManifestRecord): Promise<MailboxBackend>;
}

// ─── CompilerFactory ───

export interface CompilerFactory {
  readonly compilerType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: CompilerManifestRecord): Promise<Compiler>;
}

// ─── CompileReturnTransportFactory ───

export interface CompileReturnTransportFactory {
  readonly endpointType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: CompileReturnEndpointRecord): Promise<CompileReturnTransport>;
}
