// packages/planners/db-lexicon/src/internal/fixture-loader.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §2.2, §2.4, §4.1, log
// ADD-PLANNER-LEXICON-003.
//
// Loads + verifies the 8 on-disk lexicon JSONL fixtures, validates
// per-record schema, asserts cross-fixture invariants (§2.4), and
// constructs the in-memory `LexiconTablesV1`. Called by bootstrap
// step 18a. Fail-closed at every step.
//
// Fixture format (per §2.2):
//   - First line: signed header — JSON with schemaVersion, signedAt,
//     recordCount, contentDigest, signature.
//   - Subsequent lines: one record per line, AS AUTHORED (order is
//     part of the signed payload).
//
//   contentDigest = sha256(records.map(canonicalize).join('\n'))
//   signature     = Ed25519(canonicalize({ schemaVersion, recordCount,
//                                          contentDigest, signedAt }))
//
// The ACTION_VERB + CAPABILITY_IDS cross-fixture invariants are
// asserted here at bootstrap (the same content is enforced by
// ci:gate PLANNER-LEXICON-02 at build time).

import { promises as fs } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '@nexus/runtime-utils';
import { ACTION_VERB, CAPABILITY_IDS } from '@nexus/contracts';
import type { NonEmpty } from '@nexus/contracts';
import type {
  AliasStatus,
  LexiconFixtureHeader,
  LexiconTablesV1,
  PhraseClass,
  PlannerAliasRule,
  PlannerLexicalTerm,
  PlannerTargetCatalog,
  PlannerTaskCapability,
  PlannerTaskIntent,
  PlannerWorkflowEdge,
  PlannerWorkflowNode,
  PlannerWorkflowTemplate,
  ResourceScope,
  WorkflowEdgeType,
  WorkflowNodeKind,
} from './types.js';

// @noble/ed25519 v2 requires SHA-512 to be set (same pattern as
// load-signed-manifest.ts in runtime-utils).
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

const FIXTURE_FILENAMES = [
  'planner-lexical-term.v1.jsonl',
  'planner-alias-rule.v1.jsonl',
  'planner-task-intent.v1.jsonl',
  'planner-task-capability.v1.jsonl',
  'planner-target-catalog.v1.jsonl',
  'planner-workflow-template.v1.jsonl',
  'planner-workflow-node.v1.jsonl',
  'planner-workflow-edge.v1.jsonl',
] as const;

const ACTION_VERB_SET: ReadonlySet<string> = new Set(Object.values(ACTION_VERB));
const CAPABILITY_ID_SET: ReadonlySet<string> = new Set(Object.values(CAPABILITY_IDS));

const VALID_PHRASE_CLASSES: ReadonlySet<PhraseClass> = new Set(['verb', 'noun', 'business_phrase']);
const VALID_ALIAS_STATUSES: ReadonlySet<AliasStatus> = new Set([
  'approved',
  'blocked',
  'review_required',
]);
const VALID_NODE_KINDS: ReadonlySet<WorkflowNodeKind> = new Set(['nxs', 'nvg', 'secure_handoff']);
const VALID_EDGE_TYPES: ReadonlySet<WorkflowEdgeType> = new Set([
  'data_dependency',
  'conditional',
  'sequential',
]);
const VALID_RESOURCE_SCOPES: ReadonlySet<ResourceScope> = new Set([
  'single',
  'bulk',
  'collection',
  'system',
]);

export interface LoadLexiconOptions {
  /** Directory containing the 8 JSONL fixtures (e.g. 'fixtures/planner/db-lexicon/'). */
  fixtureRoot: string;
  /** Base64url-encoded Ed25519 public key (control-plane). */
  controlPlanePublicKey: string;
  /** Known connector systems for the target catalog invariant. Empty disables the check. */
  knownConnectorSystems?: ReadonlySet<string>;
}

/**
 * Load + verify + index the 8 lexicon JSONL fixtures.
 *
 * Fail-closed at every step:
 *   - missing file
 *   - missing/malformed header line
 *   - recordCount mismatch
 *   - contentDigest mismatch
 *   - Ed25519 signature failure
 *   - per-record schema violation
 *   - cross-fixture invariant violation (verb not in ACTION_VERB,
 *     capability not in CAPABILITY_IDS, system not in connector manifest)
 */
export async function loadLexiconFixtures(opts: LoadLexiconOptions): Promise<LexiconTablesV1> {
  const root = opts.fixtureRoot;
  const pubBytes = base64urlDecode(opts.controlPlanePublicKey);

  // ── Load + verify each fixture file ──
  const verifiedRecords: Record<(typeof FIXTURE_FILENAMES)[number], unknown[]> = {} as Record<
    (typeof FIXTURE_FILENAMES)[number],
    unknown[]
  >;

  for (const filename of FIXTURE_FILENAMES) {
    const filePath = path.join(root, filename);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Lexicon fixture load failed: cannot read '${filePath}': ${(err as Error).message}`
      );
    }

    const lines = raw.split('\n').filter(line => line.length > 0);
    if (lines.length === 0) {
      throw new Error(`Lexicon fixture load failed: '${filePath}' is empty`);
    }

    // Header is first line
    let header: LexiconFixtureHeader;
    try {
      header = JSON.parse(lines[0]!) as LexiconFixtureHeader;
    } catch (err) {
      throw new Error(
        `Lexicon fixture load failed: header parse error in '${filePath}': ${(err as Error).message}`
      );
    }

    if (header.schemaVersion !== 'v1') {
      throw new Error(
        `Lexicon fixture load failed: unsupported schemaVersion '${header.schemaVersion}' in '${filePath}' (expected 'v1')`
      );
    }
    if (typeof header.recordCount !== 'number' || !Number.isInteger(header.recordCount)) {
      throw new Error(
        `Lexicon fixture load failed: recordCount must be an integer in '${filePath}'`
      );
    }
    if (typeof header.contentDigest !== 'string' || header.contentDigest.length !== 64) {
      throw new Error(
        `Lexicon fixture load failed: contentDigest must be a 64-char hex string in '${filePath}'`
      );
    }
    if (typeof header.signature !== 'string' || header.signature.length === 0) {
      throw new Error(`Lexicon fixture load failed: signature missing in '${filePath}'`);
    }
    if (typeof header.signedAt !== 'string' || header.signedAt.length === 0) {
      throw new Error(`Lexicon fixture load failed: signedAt missing in '${filePath}'`);
    }

    // Parse record lines (preserving authored order)
    const recordLines = lines.slice(1);
    if (recordLines.length !== header.recordCount) {
      throw new Error(
        `Lexicon fixture load failed: recordCount=${header.recordCount} but found ${recordLines.length} record lines in '${filePath}'`
      );
    }

    const records: unknown[] = [];
    for (let i = 0; i < recordLines.length; i++) {
      try {
        records.push(JSON.parse(recordLines[i]!));
      } catch (err) {
        throw new Error(
          `Lexicon fixture load failed: record line ${i + 1} parse error in '${filePath}': ${(err as Error).message}`
        );
      }
    }

    // Recompute contentDigest from canonicalized records joined by '\n'
    const canonicalRecords = records.map(canonicalize).join('\n');
    const recomputedDigest = sha256Hex(canonicalRecords);
    if (recomputedDigest !== header.contentDigest) {
      throw new Error(
        `Lexicon fixture load failed: contentDigest mismatch in '${filePath}' (header=${header.contentDigest}, recomputed=${recomputedDigest})`
      );
    }

    // Verify Ed25519 signature over canonicalized header payload
    const headerPayload = {
      schemaVersion: header.schemaVersion,
      recordCount: header.recordCount,
      contentDigest: header.contentDigest,
      signedAt: header.signedAt,
    };
    const canonicalHeader = canonicalize(headerPayload);
    const sigBytes = base64urlDecode(header.signature);
    const msgBytes = new TextEncoder().encode(canonicalHeader);

    let sigValid: boolean;
    try {
      sigValid = await ed25519.verifyAsync(sigBytes, msgBytes, pubBytes);
    } catch {
      sigValid = false;
    }
    if (!sigValid) {
      throw new Error(
        `Lexicon fixture load failed: Ed25519 signature verification failed for '${filePath}'`
      );
    }

    verifiedRecords[filename] = records;
  }

  // ── Validate per-record schemas + collect typed records ──
  const lexicalTerms: PlannerLexicalTerm[] = (
    verifiedRecords['planner-lexical-term.v1.jsonl'] ?? []
  ).map((rec, i) => validateLexicalTerm(rec, i));
  const aliasRules: PlannerAliasRule[] = (verifiedRecords['planner-alias-rule.v1.jsonl'] ?? []).map(
    (rec, i) => validateAliasRule(rec, i)
  );
  const taskIntents: PlannerTaskIntent[] = (
    verifiedRecords['planner-task-intent.v1.jsonl'] ?? []
  ).map((rec, i) => validateTaskIntent(rec, i));
  const taskCapabilities: PlannerTaskCapability[] = (
    verifiedRecords['planner-task-capability.v1.jsonl'] ?? []
  ).map((rec, i) => validateTaskCapability(rec, i));
  const targetCatalog: PlannerTargetCatalog[] = (
    verifiedRecords['planner-target-catalog.v1.jsonl'] ?? []
  ).map((rec, i) => validateTargetCatalog(rec, i));
  const workflowTemplates: PlannerWorkflowTemplate[] = (
    verifiedRecords['planner-workflow-template.v1.jsonl'] ?? []
  ).map((rec, i) => validateWorkflowTemplate(rec, i));
  const workflowNodes: PlannerWorkflowNode[] = (
    verifiedRecords['planner-workflow-node.v1.jsonl'] ?? []
  ).map((rec, i) => validateWorkflowNode(rec, i));
  const workflowEdges: PlannerWorkflowEdge[] = (
    verifiedRecords['planner-workflow-edge.v1.jsonl'] ?? []
  ).map((rec, i) => validateWorkflowEdge(rec, i));

  // ── Cross-fixture invariants (§2.4) ──
  // INV-01: every `phraseClass: 'verb'` canonicalTerm must be in ACTION_VERB
  for (const term of lexicalTerms) {
    if (term.phraseClass === 'verb' && !ACTION_VERB_SET.has(term.canonicalTerm)) {
      throw new Error(
        `Lexicon fixture load failed: planner-lexical-term '${term.rawTerm}' has phraseClass='verb' but canonicalTerm '${term.canonicalTerm}' is NOT a member of ACTION_VERB ` +
          `(taxonomy: ${Object.values(ACTION_VERB).join(', ')})`
      );
    }
  }

  // INV-02: every required capability in planner-task-capability must be in CAPABILITY_IDS
  for (const tc of taskCapabilities) {
    for (const cap of tc.requiredCapabilities) {
      if (!CAPABILITY_ID_SET.has(cap)) {
        throw new Error(
          `Lexicon fixture load failed: planner-task-capability intent '${tc.intentId}' requires capability '${cap}' which is NOT a member of CAPABILITY_IDS`
        );
      }
    }
  }

  // INV-03: every workflow node capability must be in CAPABILITY_IDS
  for (const node of workflowNodes) {
    if (!CAPABILITY_ID_SET.has(node.capability)) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-node (template '${node.templateId}', node '${node.nodeKey}') capability '${node.capability}' is NOT a member of CAPABILITY_IDS`
      );
    }
  }

  // INV-04: every target catalog system must be a known connector system (if enforcement enabled)
  if (opts.knownConnectorSystems && opts.knownConnectorSystems.size > 0) {
    for (const tc of targetCatalog) {
      if (!opts.knownConnectorSystems.has(tc.system)) {
        throw new Error(
          `Lexicon fixture load failed: planner-target-catalog businessTerm '${tc.businessTerm}' references system '${tc.system}' which is NOT a known connector system`
        );
      }
    }
  }

  // INV-05: every workflow template's intentId must resolve to a known intent
  const intentIdSet = new Set(taskIntents.map(i => i.intentId));
  for (const tpl of workflowTemplates) {
    if (!intentIdSet.has(tpl.intentId)) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-template '${tpl.templateId}' references intentId '${tpl.intentId}' not found in planner-task-intent`
      );
    }
  }

  // INV-06: every workflow node's templateId + nodeKey must be referenced by a template
  const templateNodeKeys = new Map<string, Set<string>>();
  for (const tpl of workflowTemplates) {
    templateNodeKeys.set(tpl.templateId, new Set(tpl.nodeIds));
  }
  for (const node of workflowNodes) {
    const expectedKeys = templateNodeKeys.get(node.templateId);
    if (!expectedKeys) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-node references unknown templateId '${node.templateId}'`
      );
    }
    if (!expectedKeys.has(node.nodeKey)) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-node (template '${node.templateId}', node '${node.nodeKey}') is not listed in the template's nodeIds`
      );
    }
  }

  // INV-07: every workflow edge's source + target must resolve to template nodes
  const nodesByTemplateMap = new Map<string, Set<string>>();
  for (const node of workflowNodes) {
    let s = nodesByTemplateMap.get(node.templateId);
    if (!s) {
      s = new Set();
      nodesByTemplateMap.set(node.templateId, s);
    }
    s.add(node.nodeKey);
  }
  for (const edge of workflowEdges) {
    const nodes = nodesByTemplateMap.get(edge.templateId);
    if (!nodes) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-edge references unknown templateId '${edge.templateId}'`
      );
    }
    if (!nodes.has(edge.sourceNodeKey)) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-edge (template '${edge.templateId}') sourceNodeKey '${edge.sourceNodeKey}' not found in template nodes`
      );
    }
    if (!nodes.has(edge.targetNodeKey)) {
      throw new Error(
        `Lexicon fixture load failed: planner-workflow-edge (template '${edge.templateId}') targetNodeKey '${edge.targetNodeKey}' not found in template nodes`
      );
    }
  }

  // ── Build derived indexes ──
  const termByRaw = new Map<string, PlannerLexicalTerm[]>();
  for (const term of lexicalTerms) {
    const key = term.rawTerm.toLowerCase();
    let list = termByRaw.get(key);
    if (!list) {
      list = [];
      termByRaw.set(key, list);
    }
    list.push(term);
  }

  const aliasByRaw = new Map<string, PlannerAliasRule>();
  for (const rule of aliasRules) {
    aliasByRaw.set(rule.rawTerm.toLowerCase(), rule);
  }

  const intentById = new Map<string, PlannerTaskIntent>();
  for (const intent of taskIntents) {
    intentById.set(intent.intentId, intent);
  }

  const capabilitiesByIntent = new Map<string, NonEmpty[]>();
  for (const tc of taskCapabilities) {
    capabilitiesByIntent.set(tc.intentId, [...tc.requiredCapabilities]);
  }

  const targetByBusinessTerm = new Map<string, PlannerTargetCatalog>();
  for (const tc of targetCatalog) {
    targetByBusinessTerm.set(tc.businessTerm.toLowerCase(), tc);
  }

  const templateById = new Map<string, PlannerWorkflowTemplate>();
  const templatesByIntent = new Map<string, PlannerWorkflowTemplate[]>();
  for (const tpl of workflowTemplates) {
    templateById.set(tpl.templateId, tpl);
    let list = templatesByIntent.get(tpl.intentId);
    if (!list) {
      list = [];
      templatesByIntent.set(tpl.intentId, list);
    }
    list.push(tpl);
  }

  const nodesByTemplate = new Map<string, PlannerWorkflowNode[]>();
  for (const node of workflowNodes) {
    let list = nodesByTemplate.get(node.templateId);
    if (!list) {
      list = [];
      nodesByTemplate.set(node.templateId, list);
    }
    list.push(node);
  }

  const edgesByTemplate = new Map<string, PlannerWorkflowEdge[]>();
  for (const edge of workflowEdges) {
    let list = edgesByTemplate.get(edge.templateId);
    if (!list) {
      list = [];
      edgesByTemplate.set(edge.templateId, list);
    }
    list.push(edge);
  }

  return {
    lexicalTerms,
    aliasRules,
    taskIntents,
    taskCapabilities,
    targetCatalog,
    workflowTemplates,
    workflowNodes,
    workflowEdges,
    termByRaw,
    aliasByRaw,
    intentById,
    capabilitiesByIntent,
    targetByBusinessTerm,
    templateById,
    templatesByIntent,
    nodesByTemplate,
    edgesByTemplate,
  };
}

// ─── Per-record schema validators ───
// Each validator returns a fully-typed record or throws a fail-closed
// error naming the file + record index. No best-effort coercion.

function assertString(value: unknown, field: string, file: string, idx: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Lexicon fixture load failed: ${file} record ${idx} field '${field}' must be a non-empty string`
    );
  }
  return value;
}

function assertNonEmpty(value: unknown, field: string, file: string, idx: number): NonEmpty {
  return assertString(value, field, file, idx) as NonEmpty;
}

function assertEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  field: string,
  file: string,
  idx: number
): T {
  const s = assertString(value, field, file, idx);
  if (!allowed.has(s as T)) {
    throw new Error(
      `Lexicon fixture load failed: ${file} record ${idx} field '${field}' value '${s}' not in allowed set {${[...allowed].join(', ')}}`
    );
  }
  return s as T;
}

function assertNonEmptyArray(value: unknown, field: string, file: string, idx: number): NonEmpty[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Lexicon fixture load failed: ${file} record ${idx} field '${field}' must be an array`
    );
  }
  return value.map((v, i) => assertNonEmpty(v, `${field}[${i}]`, file, idx));
}

function validateLexicalTerm(rec: unknown, idx: number): PlannerLexicalTerm {
  const file = 'planner-lexical-term.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    rawTerm: assertString(r['rawTerm'], 'rawTerm', file, idx),
    canonicalTerm: assertString(r['canonicalTerm'], 'canonicalTerm', file, idx),
    phraseClass: assertEnum(r['phraseClass'], VALID_PHRASE_CLASSES, 'phraseClass', file, idx),
    source: assertNonEmpty(r['source'], 'source', file, idx),
  };
}

function validateAliasRule(rec: unknown, idx: number): PlannerAliasRule {
  const file = 'planner-alias-rule.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    rawTerm: assertString(r['rawTerm'], 'rawTerm', file, idx),
    canonicalTerm: assertString(r['canonicalTerm'], 'canonicalTerm', file, idx),
    status: assertEnum(r['status'], VALID_ALIAS_STATUSES, 'status', file, idx),
    reason: assertNonEmpty(r['reason'], 'reason', file, idx),
  };
}

function validateTaskIntent(rec: unknown, idx: number): PlannerTaskIntent {
  const file = 'planner-task-intent.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    intentId: assertNonEmpty(r['intentId'], 'intentId', file, idx),
    name: assertNonEmpty(r['name'], 'name', file, idx),
    description: assertNonEmpty(r['description'], 'description', file, idx),
  };
}

function validateTaskCapability(rec: unknown, idx: number): PlannerTaskCapability {
  const file = 'planner-task-capability.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    intentId: assertNonEmpty(r['intentId'], 'intentId', file, idx),
    requiredCapabilities: assertNonEmptyArray(
      r['requiredCapabilities'],
      'requiredCapabilities',
      file,
      idx
    ),
  };
}

function validateTargetCatalog(rec: unknown, idx: number): PlannerTargetCatalog {
  const file = 'planner-target-catalog.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    businessTerm: assertString(r['businessTerm'], 'businessTerm', file, idx),
    system: assertNonEmpty(r['system'], 'system', file, idx),
    resourceType: assertNonEmpty(r['resourceType'], 'resourceType', file, idx),
    resourceScope: assertEnum(
      r['resourceScope'],
      VALID_RESOURCE_SCOPES,
      'resourceScope',
      file,
      idx
    ),
  };
}

function validateWorkflowTemplate(rec: unknown, idx: number): PlannerWorkflowTemplate {
  const file = 'planner-workflow-template.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    templateId: assertNonEmpty(r['templateId'], 'templateId', file, idx),
    name: assertNonEmpty(r['name'], 'name', file, idx),
    description: assertNonEmpty(r['description'], 'description', file, idx),
    intentId: assertNonEmpty(r['intentId'], 'intentId', file, idx),
    nodeIds: assertNonEmptyArray(r['nodeIds'], 'nodeIds', file, idx),
  };
}

function validateWorkflowNode(rec: unknown, idx: number): PlannerWorkflowNode {
  const file = 'planner-workflow-node.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  return {
    templateId: assertNonEmpty(r['templateId'], 'templateId', file, idx),
    nodeKey: assertNonEmpty(r['nodeKey'], 'nodeKey', file, idx),
    capability: assertNonEmpty(r['capability'], 'capability', file, idx),
    kind: assertEnum(r['kind'], VALID_NODE_KINDS, 'kind', file, idx),
    expectedOutputSlots: assertNonEmptyArray(
      r['expectedOutputSlots'],
      'expectedOutputSlots',
      file,
      idx
    ),
  };
}

function validateWorkflowEdge(rec: unknown, idx: number): PlannerWorkflowEdge {
  const file = 'planner-workflow-edge.v1.jsonl';
  if (typeof rec !== 'object' || rec === null) {
    throw new Error(`Lexicon fixture load failed: ${file} record ${idx} is not an object`);
  }
  const r = rec as Record<string, unknown>;
  const outputSlotRefRaw = r['outputSlotRef'];
  let outputSlotRef: NonEmpty | null = null;
  if (outputSlotRefRaw !== null && outputSlotRefRaw !== undefined) {
    outputSlotRef = assertNonEmpty(outputSlotRefRaw, 'outputSlotRef', file, idx);
  }
  return {
    templateId: assertNonEmpty(r['templateId'], 'templateId', file, idx),
    sourceNodeKey: assertNonEmpty(r['sourceNodeKey'], 'sourceNodeKey', file, idx),
    targetNodeKey: assertNonEmpty(r['targetNodeKey'], 'targetNodeKey', file, idx),
    edgeType: assertEnum(r['edgeType'], VALID_EDGE_TYPES, 'edgeType', file, idx),
    outputSlotRef,
  };
}
