// packages/contracts/src/externals/factory-registries.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §5.1, §3.13 — Factory Registry Interfaces
// Layer 2 — factory registry contracts for externals manifest loading.
//
// Factory registries are populated in bootstrap Step 01 before any manifest
// loader runs. Every enabled manifest entry discriminator must resolve in its
// domain factory registry. Missing factory resolution fails closed.
//
// Pattern follows existing transport-registries.ts (§12.3.45–§12.3.47).

import type { WorkspaceFactory } from './factories.js';
import type { OrchestratorFactory } from './factories.js';
import type { MailboxBackendFactory } from './factories.js';
import type { CompilerFactory } from './factories.js';
import type { CompileReturnTransportFactory } from './factories.js';

// ─── WorkspaceFactoryRegistry ───

export interface WorkspaceFactoryRegistry {
  register(factory: WorkspaceFactory): void;
  get(workspaceType: string): WorkspaceFactory | null;
  list(): WorkspaceFactory[];
}

// ─── OrchestratorFactoryRegistry ───

export interface OrchestratorFactoryRegistry {
  register(factory: OrchestratorFactory): void;
  get(orchestratorType: string): OrchestratorFactory | null;
  list(): OrchestratorFactory[];
}

// ─── MailboxBackendFactoryRegistry ───

export interface MailboxBackendFactoryRegistry {
  register(factory: MailboxBackendFactory): void;
  get(mailboxType: string): MailboxBackendFactory | null;
  list(): MailboxBackendFactory[];
}

// ─── CompilerFactoryRegistry ───

export interface CompilerFactoryRegistry {
  register(factory: CompilerFactory): void;
  get(compilerType: string): CompilerFactory | null;
  list(): CompilerFactory[];
}

// ─── CompileReturnTransportFactoryRegistry ───

export interface CompileReturnTransportFactoryRegistry {
  register(factory: CompileReturnTransportFactory): void;
  get(endpointType: string): CompileReturnTransportFactory | null;
  list(): CompileReturnTransportFactory[];
}
