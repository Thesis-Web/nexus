// packages/contracts/src/externals/output-references.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.4 — Output References
// Layer 2 — architecture-level output reference schemas.
//
// An output reference is NOT raw payload. It is metadata plus a payload
// reference and digest. NVG/NXS internals do not write mailbox items directly;
// the composition boundary adapts their returns into these output references.
//
// Law:
// - resultRef must be resolvable by the configured output collector and mailbox backend.
// - resultDigest must be SHA-256 of the exact bytes stored at or represented by resultRef.
// - resultClassifications must be non-empty when mailbox classificationRequired = true.
// - redactionState = 'blocked' makes the reference non-compile-eligible.

import type { Uuid, IsoTimestamp, Sha256Hex, NonEmpty } from '../types/index.js';
import type { DataClass, OctLevel, ModelTier, FinalOutcome } from '../constants/index.js';

export type OutputSourceType = 'nvg_result' | 'nxs_execution_result' | 'agent_partial';

export interface BaseOutputReference {
  outputReferenceId: Uuid;
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  sourceType: OutputSourceType;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  octLevel: OctLevel;
  createdAt: IsoTimestamp;
  redactionState: 'not_required' | 'redacted' | 'blocked';
}

export interface NvgOutputReference extends BaseOutputReference {
  sourceType: 'nvg_result';
  routingTrailRecordId: Uuid;
  trailCorrelationId: Uuid;
  modelTierInvoked: ModelTier | null;
  responseSize: number | null;
}

export interface NxsOutputReference extends BaseOutputReference {
  sourceType: 'nxs_execution_result';
  evidenceRecordId: Uuid;
  executionGrantId: Uuid | null;
  finalOutcome: FinalOutcome;
}

export interface AgentPartialOutputReference extends BaseOutputReference {
  sourceType: 'agent_partial';
  producerKind: 'orchestrator' | 'agent' | 'adapter';
  parentOutputReferenceId: Uuid | null;
}
