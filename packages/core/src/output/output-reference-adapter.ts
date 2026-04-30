/**
 * Output Reference Adapter — AMEND-spec §6.4, §6.5, §6.6
 *
 * File: packages/core/src/output/output-reference-adapter.ts
 * Layer 1 — composition boundary helpers.
 *
 * These helpers create output references from engine results at the
 * composition boundary. NVG/NXS engines do not create output references
 * directly — the composition root adapts their returns.
 *
 * Note: actual NVG/NXS result adaptation is wired in bootstrap (EXT-11).
 * These are the helper functions that bootstrap calls.
 */
import { randomUUID } from 'node:crypto';
import type {
  NvgOutputReference,
  NxsOutputReference,
  AgentPartialOutputReference,
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  DataClass,
  OctLevel,
  ModelTier,
  FinalOutcome,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';

export interface NvgResultInput {
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  octLevel: OctLevel;
  redactionState: 'not_required' | 'redacted' | 'blocked';
  routingTrailRecordId: Uuid;
  trailCorrelationId: Uuid;
  modelTierInvoked: ModelTier | null;
  responseSize: number | null;
}

export function createNvgOutputReference(input: NvgResultInput): NvgOutputReference {
  return {
    outputReferenceId: randomUUID() as Uuid,
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    slotId: input.slotId,
    sourceType: 'nvg_result',
    resultRef: input.resultRef,
    resultDigest: input.resultDigest,
    resultClassifications: input.resultClassifications,
    octLevel: input.octLevel,
    createdAt: nowIso(),
    redactionState: input.redactionState,
    routingTrailRecordId: input.routingTrailRecordId,
    trailCorrelationId: input.trailCorrelationId,
    modelTierInvoked: input.modelTierInvoked,
    responseSize: input.responseSize,
  };
}

export interface NxsResultInput {
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  octLevel: OctLevel;
  redactionState: 'not_required' | 'redacted' | 'blocked';
  evidenceRecordId: Uuid;
  executionGrantId: Uuid | null;
  finalOutcome: FinalOutcome;
}

export function createNxsOutputReference(input: NxsResultInput): NxsOutputReference {
  return {
    outputReferenceId: randomUUID() as Uuid,
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    slotId: input.slotId,
    sourceType: 'nxs_execution_result',
    resultRef: input.resultRef,
    resultDigest: input.resultDigest,
    resultClassifications: input.resultClassifications,
    octLevel: input.octLevel,
    createdAt: nowIso(),
    redactionState: input.redactionState,
    evidenceRecordId: input.evidenceRecordId,
    executionGrantId: input.executionGrantId,
    finalOutcome: input.finalOutcome,
  };
}

export interface AgentPartialInput {
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  octLevel: OctLevel;
  redactionState: 'not_required' | 'redacted' | 'blocked';
  producerKind: 'orchestrator' | 'agent' | 'adapter';
  parentOutputReferenceId: Uuid | null;
}

export function createAgentPartialOutputReference(
  input: AgentPartialInput
): AgentPartialOutputReference {
  return {
    outputReferenceId: randomUUID() as Uuid,
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    slotId: input.slotId,
    sourceType: 'agent_partial',
    resultRef: input.resultRef,
    resultDigest: input.resultDigest,
    resultClassifications: input.resultClassifications,
    octLevel: input.octLevel,
    createdAt: nowIso(),
    redactionState: input.redactionState,
    producerKind: input.producerKind,
    parentOutputReferenceId: input.parentOutputReferenceId,
  };
}
