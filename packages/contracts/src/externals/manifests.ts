// packages/contracts/src/externals/manifests.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.11 — Manifest Record Types
// AMEND-spec-nexus-orch §4.2 — OrchestratorManifestRecord Extensions
// SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — IdentityProvider/Connector/Channel records lifted (Claude C).
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
// - Identity/Connector/Channel records are lifted to contracts so that the
//   admin-setup projection routes (Layer 7) can describe them by import
//   without violating layer rules. The core loaders' local definitions are
//   structurally identical and continue to work through TypeScript's
//   structural typing.

import type { Uuid, NonEmpty } from '../types/index.js';
import type { DataClass } from '../constants/index.js';
import type { CompileMode } from './compiler.js';

// ─── OutputSlotPolicy ───

export type OutputSlotPolicy = 'strict_declared_slots' | 'advisory_declared_slots' | 'open_slots';

// ─── IdentityProviderManifestRecord (lifted from core) ───
//
// Loader-canonical shape from packages/core/src/manifest/identity/identity-manifest-loader.ts.
// `enabled` is NOT exposed: the loader filters disabled rows and only emits
// enabled providers. (HOLE-C01 surfaces this loader-filter behavior.)

export interface IdentityProviderManifestRecord {
  readonly providerId: NonEmpty;
  readonly providerType: NonEmpty;
  readonly configuration: Record<string, unknown>;
}

// ─── ConnectorManifestRecord (lifted from core) ───

export interface ConnectorManifestRecord {
  readonly connectorId: NonEmpty;
  readonly connectorType: NonEmpty;
  readonly allowedSystems: string[];
  readonly dataClass: DataClass;
  readonly configuration: Record<string, unknown>;
}

// ─── ChannelManifestRecord (lifted from core) ───

export interface ChannelManifestRecord {
  readonly channelId: NonEmpty;
  readonly channelType: NonEmpty;
  readonly configuration: Record<string, unknown>;
}

// ─── WorkspaceManifestRecord ───

export interface WorkspaceManifestRecord {
  workspaceSocketId: NonEmpty;
  workspaceType: NonEmpty;
  enabled: boolean;
  entryMode: 'governed_only' | 'free_chat';
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
  // ── AMEND-spec-nexus-orch §4.2 — planner/amendment/partial fields ──
  plannerType: NonEmpty;
  plannerVersion: NonEmpty;
  plannerConfiguration: Record<string, unknown>;
  planAmendment: {
    enabled: boolean;
    maxAmendments: number;
    requiresCheckback: boolean;
  };
  partialCompletion: {
    enabled: boolean;
    minRequiredCompletedNodes: number;
    compileOnPartial: boolean;
  };
  /**
   * Bound on LLM tool-call iterations within a single nvg_dispatch node.
   * One "tool turn" = orch calls NVG → model emits tool_calls → orch
   * dispatches each through NXS → bridge to mailbox → orch feeds
   * tool_results back → orch calls NVG again. The cap stops the
   * orchestrator from re-entering NVG once this many turns have completed,
   * even if the model is still asking for tools — bounding model spend +
   * NXS gate runs + ledger churn per node. Sibling concept to
   * `maxSplitDepth` (which bounds DAG fan-out); both are governance
   * resource bounds. Must be ≥ 1.
   */
  maxToolTurnsPerNode: number;
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
