// packages/contracts/src/externals/compile-template.ts
// AMEND-spec-nexus-compile-1-0-0 §2 — Compile Template Contracts
// Layer 2 — template tree, guard system, preferences, and future interfaces.
//
// CompileTemplate ≠ OutputContract. Different types, zones, lifecycles.
// OutputContract = audit metadata (what is in the mailbox for a run).
// CompileTemplate = layout manifest (how to assemble the output).
//
// Blueprint pins: §4 (two-zone), §6 (template tree), §7 (guards),
// §8 (matching/validation), §9 (contract designer), §11 (signing),
// §12 (denial handling).

import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty } from '../types/index.js';

// ─── Enums ───

export type CompileFormat = 'prose' | 'table' | 'raw' | 'mixed' | 'file_bundle';
export type DenialHandling = 'inline' | 'separate_section' | 'omit';
export type ContentGranularity = 'block' | 'paragraph' | 'sentence' | 'inline';
export type EntityRegistryName = 'actor' | 'principal' | 'system' | 'connector' | 'template';

// ─── Slot Types — 10 types [blueprint §6.4] ───

export type SlotTypeName =
  | 'string'
  | 'number'
  | 'date'
  | 'enum'
  | 'entity_ref'
  | 'prose'
  | 'table'
  | 'repeating_group'
  | 'asset_ref'
  | 'computed';

export interface SlotType {
  type: SlotTypeName;
  granularity?: ContentGranularity;
  maxLength?: number;
  min?: number;
  max?: number;
  values?: string[];
  registry?: EntityRegistryName; // required when type === 'entity_ref'
  childLocations?: CompileLocation[]; // required when type === 'repeating_group'
  computeFn?: string; // required when type === 'computed'
  computeScope?: 'same_agent'; // required when type === 'computed'
}

// ─── Template Tree [blueprint §6] ───

export interface CompileLocation {
  locationId: NonEmpty;
  position: number;
  assignedAgentId: Uuid;
  expectedSlotId: NonEmpty;
  slotType: SlotType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export interface CompileSection {
  sectionId: NonEmpty;
  position: number;
  title: string;
  assignedAgentId: Uuid;
  expectedContentType: 'prose' | 'table' | 'data' | 'file' | 'mixed';
  locations: CompileLocation[];
  formatHint?: string;
}

// ─── Guard System [blueprint §7] ───

export interface GuardCondition {
  locationPath: string;
  operator:
    | '=='
    | '!='
    | '>'
    | '<'
    | '>='
    | '<='
    | 'is_empty'
    | 'is_filled'
    | 'count_gt'
    | 'count_lt';
  value?: string | number | boolean;
}

export interface GuardAction {
  targetLocationPath: string;
  effect: 'set_required' | 'set_value' | 'block_section' | 'add_warning';
  value?: string | number | boolean;
}

export interface CompileGuard {
  guardId: NonEmpty;
  name: string;
  when: GuardCondition;
  then: GuardAction;
  severity: 'halt' | 'warn_and_mark' | 'auto_fix';
}

// ─── CompileTemplate [blueprint §4, §6, §11] ───
// Zone 1 (Registry): persistent, signed, immutable, in SQLite.
// Zone 2 (Session): ephemeral compile state, dies after artifact emission.
// Digest: sha256(canonicalize({ templateId, templateVersion, format,
//   sections, guards, denialHandling, createdAt, createdBy })) [blueprint §11.2]

export interface CompileTemplate {
  templateId: NonEmpty;
  templateVersion: NonEmpty;
  format: CompileFormat;
  sections: CompileSection[];
  guards: CompileGuard[];
  denialHandling: DenialHandling;
  createdAt: IsoTimestamp;
  createdBy: 'user' | 'orchestrator' | 'contract_designer' | 'default';
  templateDigest: Sha256Hex;
  signature: Base64Url;
}

// ─── Preferences ───

export interface CompilePreferences {
  format: CompileFormat;
  sectionOrder?: string[];
  denialHandling?: DenialHandling;
  locale?: string;
  customInstructions?: string;
}

// ─── Agent Task Summary (future — orchestrator → contract designer) ───

export interface AgentTaskSummary {
  agentId: Uuid;
  taskId: Uuid;
  taskSummary: NonEmpty;
  expectedOutputSlots: NonEmpty[];
  capabilities: string[];
}

// ─── Contract Designer — interface only in V1 [blueprint §9] ───

export interface ContractDesigner {
  readonly designerId: NonEmpty;
  readonly designerVersion: NonEmpty;
  designTemplate(
    runId: Uuid,
    agentSummaries: AgentTaskSummary[],
    outputPreferences: CompilePreferences | null
  ): Promise<CompileTemplate>;
}
