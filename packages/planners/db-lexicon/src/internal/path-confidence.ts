// packages/planners/db-lexicon/src/internal/path-confidence.ts
// AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0.md §5 — fourth-layer
// path-confidence scorer. Pure, deterministic, side-effect-free.
//
// Inputs are the read-models from the fourth-layer JSONL fixtures
// (loaded by `path-fixture-reader`), plus a `satisfiesRequirement`
// callback that the caller composes against runtime availability of
// capabilities/agents/connectors/mailboxes/compile-templates.
//
// Output is a `PathFeasibilityResult` (shared contract, per AMEND §5.3).
// The planner consults this result before constructing an executable
// plan; non-executable outcomes route to typed checkback or lawful
// unsupported-path per §5.4.
//
// This module MUST NOT:
//   - call the LLM, target system, NXS, NVG, mailbox, compile;
//   - mutate any lexicon record (mutation flows through SigningCouncil
//     2-of-2 only);
//   - replace governance authority (NXS Gate 01-07 stays sole action
//     authority; this scorer is feasibility-only).
//
// Layer: planner-internal (not exported from the package barrel).

import type {
  LexiconPathContradiction,
  LexiconPathEvidence,
  LexiconPathKind,
  LexiconPathProfile,
  LexiconPathRequirement,
  LexiconCheckbackTemplate,
  LexiconCheckbackKind,
  PathFeasibilityMissingRequirement,
  PathFeasibilityResult,
  NonEmpty,
} from '@nexus/contracts';

// ── Thresholds (AMEND §5.4) ──────────────────────────────────────────────
export const MIN_EXECUTABLE_CONFIDENCE = 0.75;
export const MIN_EXECUTABLE_COMPLETENESS = 1.0;
export const MAX_EXECUTABLE_FAILURE_LIKELIHOOD = 0.25;

// ── Deterministic path-id builder (AMEND §5.2 step 4) ────────────────────
//
// path_id is `<prefix>:<sourceRef>` where prefix is the canonical table
// name for the LexiconPathKind. See AMEND §4.2 examples:
//   planner_task_intent:inventory.adjust_from_receiving
//   planner_workflow_template:workflow_inventory_adjust_from_receiving_v1
//   planner_workflow_node:workflow_inventory_adjust_from_receiving_v1/read_inventory
//   planner_alias_rule:drop table
//   lexicon_entity:verb_pull
//
// The prefix is REQUIRED so the path-id namespace can never collide
// across kinds (a `task_intent:foo` is provably distinct from a
// `workflow_template:foo`).

const PATH_ID_PREFIX: Record<LexiconPathKind, string> = {
  lexical_term: 'planner_lexical_term',
  alias_rule: 'planner_alias_rule',
  task_intent: 'planner_task_intent',
  task_capability: 'planner_task_capability',
  target_catalog: 'planner_target_catalog',
  workflow_template: 'planner_workflow_template',
  workflow_node: 'planner_workflow_node',
  workflow_edge: 'planner_workflow_edge',
  entity: 'lexicon_entity',
  edge: 'lexicon_edge',
  guard: 'lexicon_guard',
  checkback_template: 'lexicon_checkback_template',
};

/**
 * Build a deterministic `path_id` for a given LexiconPathKind +
 * sourceRef. The ref MUST NOT contain a colon (the separator is `:`).
 *
 * Throws on empty ref or ref containing `:`.
 */
export function buildPathId(kind: LexiconPathKind, sourceRef: string): NonEmpty {
  if (sourceRef.length === 0) {
    throw new Error('PATH_ID_BUILD_EMPTY_REF');
  }
  if (sourceRef.includes(':')) {
    throw new Error(`PATH_ID_BUILD_REF_HAS_COLON: kind=${kind} ref=${sourceRef}`);
  }
  return `${PATH_ID_PREFIX[kind]}:${sourceRef}` as NonEmpty;
}

/**
 * Build a workflow-node path_id from the parent template id + the node
 * key. Convenience overload of {@link buildPathId} — workflow nodes
 * encode `<templateId>/<nodeKey>` after the kind prefix per §4.2.
 */
export function buildWorkflowNodePathId(templateId: string, nodeKey: string): NonEmpty {
  if (templateId.length === 0 || nodeKey.length === 0) {
    throw new Error('PATH_ID_BUILD_EMPTY_TEMPLATE_OR_NODE');
  }
  if (templateId.includes(':') || nodeKey.includes(':')) {
    throw new Error('PATH_ID_BUILD_TEMPLATE_OR_NODE_HAS_COLON');
  }
  if (templateId.includes('/') || nodeKey.includes('/')) {
    throw new Error('PATH_ID_BUILD_TEMPLATE_OR_NODE_HAS_SLASH');
  }
  return buildPathId('workflow_node', `${templateId}/${nodeKey}`);
}

// ── Scorer inputs ────────────────────────────────────────────────────────
//
// The scorer is pure: caller assembles the per-path slice of the read
// model and provides the runtime-availability seam via
// `satisfiesRequirement`.

export interface PathScoreInput {
  readonly pathId: NonEmpty;
  /** May be null for an unknown path. */
  readonly profile: LexiconPathProfile | null;
  /** Evidence rows for this pathId — used only to surface refs in result. */
  readonly evidence: ReadonlyArray<LexiconPathEvidence>;
  /** Contradictions where this pathId is one of the two sides (any side). */
  readonly contradictions: ReadonlyArray<LexiconPathContradiction>;
  /** Requirements for this pathId. */
  readonly requirements: ReadonlyArray<LexiconPathRequirement>;
  /**
   * Checkback templates loaded by the planner. The scorer selects the
   * first template whose `checkbackKind` matches the deduced reason.
   * Selection is deterministic: array order is preserved by the reader.
   */
  readonly checkbackTemplates: ReadonlyArray<LexiconCheckbackTemplate>;
  /**
   * Runtime-availability seam. The scorer asks the caller whether a
   * specific requirement is satisfied (e.g. is the connector enabled,
   * is the agent capable, is the mailbox configured). Returning false
   * here causes the requirement to be reported as missing.
   */
  readonly satisfiesRequirement: (req: LexiconPathRequirement) => boolean;
}

// ── Helper: pick a checkback template for a kind ─────────────────────────
function pickCheckback(
  templates: ReadonlyArray<LexiconCheckbackTemplate>,
  kind: LexiconCheckbackKind
): NonEmpty | null {
  const hit = templates.find(t => t.checkbackKind === kind);
  return hit ? hit.templateId : null;
}

// ── Helper: requirement kind → checkback kind ────────────────────────────
function checkbackKindForRequirementKind(req: LexiconPathRequirement): LexiconCheckbackKind {
  switch (req.requirementKind) {
    case 'capability':
      return 'missing_capability';
    case 'agent':
      return 'missing_agent';
    case 'connector':
      return 'missing_connector';
    case 'target_system':
      return 'missing_target_system';
    case 'mailbox':
      return 'missing_mailbox';
    case 'compile_template':
      return 'missing_compile_template';
    case 'slot_read':
    case 'slot_write':
      return 'missing_slot';
    case 'approval_channel':
      return 'approval_required';
    case 'admin_signature':
      return 'admin_signature_required';
    case 'identity_claim':
    case 'policy_bundle':
    case 'environment':
    case 'model_tier_hint':
      // No dedicated checkback kind today; treat as unsupported and
      // surface via failureCode + missingRequirements detail.
      return 'unsupported_path';
  }
}

// ── Scorer ───────────────────────────────────────────────────────────────
//
// Decision order (AMEND §5.4):
//   1. profile missing → unsupported_path
//   2. profile.promotionStatus === 'blocked' → blocked_path
//   3. open critical/high contradiction → contradicted_path
//   4. open contradiction with owner_ruling_required → typed_checkback
//      (kind='unsupported_path' template; planner surfaces "owner
//      ruling needed")
//   5. missing required requirement → typed_checkback if a template
//      exists, else unsupported_path
//   6. confidence < MIN → typed_checkback (kind='ambiguous_intent')
//   7. completeness < MIN → typed_checkback (kind matching the most
//      severe missing requirement, or 'unsupported_path')
//   8. failureLikelihood > MAX → likely_failure
//   9. otherwise → executable

export function scorePath(input: PathScoreInput): PathFeasibilityResult {
  const { pathId, profile, evidence, contradictions, requirements, checkbackTemplates } = input;
  const evidenceRefs: ReadonlyArray<NonEmpty> = evidence.map(e => e.evidenceId);

  // Rule 1 — profile missing.
  if (profile === null) {
    return {
      pathId,
      outcome: 'unsupported_path',
      confidenceScore: 0,
      completenessScore: 0,
      failureLikelihood: 1,
      missingRequirements: [],
      openContradictions: [],
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'unsupported_path'),
      evidenceRefs,
    };
  }

  // Rule 2 — blocked path.
  if (profile.promotionStatus === 'blocked') {
    return {
      pathId,
      outcome: 'blocked_path',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: [],
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'unsupported_path'),
      evidenceRefs,
    };
  }

  // Rule 3+4 — open contradictions.
  const openContradictions = contradictions.filter(c => c.resolverStatus === 'open');
  const openIds = openContradictions.map(c => c.contradictionId) as ReadonlyArray<NonEmpty>;

  const criticalContradiction = openContradictions.find(
    c => c.severity === 'critical' || c.severity === 'high'
  );
  if (criticalContradiction) {
    return {
      pathId,
      outcome: 'contradicted_path',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: openIds,
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'unsupported_path'),
      evidenceRefs,
    };
  }

  const ownerRulingContradiction = contradictions.find(
    c => c.resolverStatus === 'owner_ruling_required'
  );
  if (ownerRulingContradiction) {
    return {
      pathId,
      outcome: 'typed_checkback',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: openIds,
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'unsupported_path'),
      evidenceRefs,
    };
  }

  // Rule 5 — missing required requirements.
  const missing: PathFeasibilityMissingRequirement[] = [];
  for (const req of requirements) {
    if (!req.required) continue;
    if (input.satisfiesRequirement(req)) continue;
    missing.push({
      requirementKind: req.requirementKind,
      requirementRef: req.requirementRef,
      failureCode: req.failureCode ?? null,
    });
  }
  if (missing.length > 0) {
    // Choose checkback template based on the FIRST missing required
    // requirement that requested a checkback (deterministic by reader
    // order). If none requested a checkback, fall back to
    // 'unsupported_path'.
    const reqForCheckback = requirements.find(
      r =>
        r.required &&
        r.checkbackIfMissing &&
        missing.some(m => m.requirementRef === r.requirementRef)
    );
    const checkbackKind: LexiconCheckbackKind = reqForCheckback
      ? checkbackKindForRequirementKind(reqForCheckback)
      : 'unsupported_path';
    const templateId = pickCheckback(checkbackTemplates, checkbackKind);
    return {
      pathId,
      outcome: templateId !== null && reqForCheckback ? 'typed_checkback' : 'unsupported_path',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: missing,
      openContradictions: openIds,
      checkbackTemplateId: templateId,
      evidenceRefs,
    };
  }

  // Rule 6 — low confidence.
  if (profile.confidenceScore < MIN_EXECUTABLE_CONFIDENCE) {
    return {
      pathId,
      outcome: 'typed_checkback',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: openIds,
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'ambiguous_intent'),
      evidenceRefs,
    };
  }

  // Rule 7 — completeness gap (no missing requirement reported above
  // implies the gap is non-requirement, e.g. unscored optional slot).
  // Falls through to typed_checkback / unsupported_path with the
  // generic 'unsupported_path' template.
  if (profile.completenessScore < MIN_EXECUTABLE_COMPLETENESS) {
    const templateId = pickCheckback(checkbackTemplates, 'unsupported_path');
    return {
      pathId,
      outcome: templateId !== null ? 'typed_checkback' : 'unsupported_path',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: openIds,
      checkbackTemplateId: templateId,
      evidenceRefs,
    };
  }

  // Rule 8 — high failure likelihood.
  if (profile.failureLikelihood > MAX_EXECUTABLE_FAILURE_LIKELIHOOD) {
    return {
      pathId,
      outcome: 'likely_failure',
      confidenceScore: profile.confidenceScore,
      completenessScore: profile.completenessScore,
      failureLikelihood: profile.failureLikelihood,
      missingRequirements: [],
      openContradictions: openIds,
      checkbackTemplateId: pickCheckback(checkbackTemplates, 'likely_run_failure'),
      evidenceRefs,
    };
  }

  // Rule 9 — executable.
  return {
    pathId,
    outcome: 'executable',
    confidenceScore: profile.confidenceScore,
    completenessScore: profile.completenessScore,
    failureLikelihood: profile.failureLikelihood,
    missingRequirements: [],
    openContradictions: openIds,
    checkbackTemplateId: null,
    evidenceRefs,
  };
}
