// packages/contracts/src/externals/manifests.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.11 — Manifest Record Types
// Layer 2 — typed outputs of manifest loaders.
//
// These records describe sockets and endpoints. They do not compose runtime
// services. Plugin authors need socket shape compatibility; ExternalsRuntime
// remains bootstrap-owned and is NOT exported from this package.
//
// Law:
// - Manifest record types may live in contracts because plugin authors need
//   socket shape compatibility.
// - outputSlotPolicy is declared by the orchestrator manifest and enforced
//   by OutputCollector when it can resolve the run plan.

import type { Uuid, NonEmpty } from '../types/index.js';
import type { CompileMode } from './compiler.js';

// ─── OutputSlotPolicy ───

export type OutputSlotPolicy = 'strict_declared_slots' | 'advisory_declared_slots' | 'open_slots';

// ─── WorkspaceManifestRecord ───

export interface WorkspaceManifestRecord {
  workspaceSocketId: NonEmpty;
  workspaceType: NonEmpty;
  enabled: boolean;
  entryMode: 'governed_only';
  baseUrl: NonEmpty;
  returnEndpointId: NonEmpty;
  capabilities: {
    promptEntry: boolean;
    planReview: boolean;
    finalDisplay: boolean;
    fileSpace: boolean;
  };
  configuration: Record<string, unknown>;
}

// ─── OrchestratorManifestRecord ───

export interface OrchestratorManifestRecord {
  orchestratorSocketId: NonEmpty;
  orchestratorType: NonEmpty;
  enabled: boolean;
  orchestratorActorId: Uuid;
  plannerMode: 'deterministic_first' | 'policy_template' | 'llm_assisted';
  maxSplitDepth: number;
  planCheckbackDefault: boolean;
  secureMode: {
    octSecureDefault: 'single_agent_no_helper';
    allowSecureMultiAgentOnlyBySignedPolicy: boolean;
  };
  retryPolicy: {
    transientAutoRetryCount: number;
  };
  timeouts: {
    systemActionMs: number;
    modelCallMs: number;
  };
  outputSlotPolicy: OutputSlotPolicy;
  configuration: Record<string, unknown>;
}

// ─── MailboxManifestRecord ───

export interface MailboxManifestRecord {
  mailboxId: NonEmpty;
  mailboxType: NonEmpty;
  enabled: boolean;
  required: boolean;
  storageRoot: NonEmpty;
  retentionPolicy: {
    payloadTtlSeconds: number;
    metadataRetention: 'run_ledger';
  };
  classificationRequired: boolean;
  digestRequired: boolean;
  configuration: Record<string, unknown>;
}

// ─── CompilerArtifactSigning ───

export type CompilerArtifactSigning =
  | { kind: 'control_plane' }
  | { kind: 'actor_registry_key'; keyId: NonEmpty };

// ─── CompilerManifestRecord ───

export interface CompilerManifestRecord {
  compilerSocketId: NonEmpty;
  compilerType: NonEmpty;
  enabled: boolean;
  actorRegistration: 'exempt_reference_deterministic_renderer' | 'required';
  compilerActorId: Uuid | null;
  octMode: 'OCT-COMPILE';
  allowedModes: CompileMode[];
  readsFromMailboxId: NonEmpty;
  outputContractVersion: 'v1';
  artifactSigning: CompilerArtifactSigning;
  configuration: Record<string, unknown>;
}

// ─── CompileReturnEndpointRecord ───

export interface CompileReturnEndpointRecord {
  returnEndpointId: NonEmpty;
  endpointType: 'http_callback';
  enabled: boolean;
  targetWorkspaceSocketId: NonEmpty;
  url: NonEmpty;
  auth: {
    kind: 'signed_callback';
    keyId: NonEmpty;
  };
  acceptedArtifactTypes: NonEmpty[];
  configuration: Record<string, unknown>;
}
