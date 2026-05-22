// packages/planners/db-lexicon/src/internal/path-confidence.test.ts
// AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0 §9.1 — unit tests for
// the deterministic path-id builder and the pure scorer.

import { describe, it, expect } from 'vitest';
import type {
  LexiconCheckbackTemplate,
  LexiconPathContradiction,
  LexiconPathEvidence,
  LexiconPathProfile,
  LexiconPathRequirement,
  NonEmpty,
  IsoTimestamp,
} from '@nexus/contracts';
import {
  buildPathId,
  buildWorkflowNodePathId,
  scorePath,
  MIN_EXECUTABLE_CONFIDENCE,
  MAX_EXECUTABLE_FAILURE_LIKELIHOOD,
} from './path-confidence.js';

const NOW = '2026-05-22T12:00:00.000Z' as IsoTimestamp;

function makeProfile(
  partial: Partial<LexiconPathProfile> & { pathId: NonEmpty }
): LexiconPathProfile {
  return {
    pathId: partial.pathId,
    pathKind: partial.pathKind ?? 'task_intent',
    sourceRef: partial.sourceRef ?? partial.pathId,
    arenaId: partial.arenaId ?? ('lex-arena-test' as NonEmpty),
    confidenceScore: partial.confidenceScore ?? 0.9,
    completenessScore: partial.completenessScore ?? 1.0,
    failureLikelihood: partial.failureLikelihood ?? 0.05,
    promotionStatus: partial.promotionStatus ?? 'confirmed',
    ...(partial.coverageCategory !== undefined
      ? { coverageCategory: partial.coverageCategory }
      : {}),
    ...(partial.notes !== undefined ? { notes: partial.notes } : {}),
    createdAt: partial.createdAt ?? NOW,
    updatedAt: partial.updatedAt ?? NOW,
    mutationId: partial.mutationId ?? ('m-fixture' as NonEmpty),
  };
}

function template(
  id: string,
  kind: LexiconCheckbackTemplate['checkbackKind']
): LexiconCheckbackTemplate {
  return {
    templateId: id as NonEmpty,
    checkbackKind: kind,
    promptTitle: `prompt-${id}` as NonEmpty,
    operatorQuestion: `q-${id}` as NonEmpty,
    safeOptionsJson: '[]' as NonEmpty,
    defaultAction: 'cancel',
    createdAt: NOW,
    updatedAt: NOW,
    mutationId: 'm-tpl' as NonEmpty,
  };
}

function evidence(id: string, pathId: string): LexiconPathEvidence {
  return {
    evidenceId: id as NonEmpty,
    pathId: pathId as NonEmpty,
    evidenceKind: 'blueprint_pin',
    sourceRef: 'docs/x.md' as NonEmpty,
    sourceDigest: 'sha256-x' as NonEmpty,
    independenceGroup: 'g1' as NonEmpty,
    confidenceDelta: 0.1,
    evidenceSummary: 'fixture' as NonEmpty,
    createdAt: NOW,
    mutationId: 'm-ev' as NonEmpty,
  };
}

function contradiction(
  id: string,
  partial: Partial<LexiconPathContradiction>
): LexiconPathContradiction {
  return {
    contradictionId: id as NonEmpty,
    pathIdA: 'p:a' as NonEmpty,
    pathIdB: 'p:b' as NonEmpty,
    contradictionKind: partial.contradictionKind ?? 'semantic_conflict',
    severity: partial.severity ?? 'low',
    resolverStatus: partial.resolverStatus ?? 'open',
    summary: 'fixture' as NonEmpty,
    createdAt: NOW,
    mutationId: 'm-contra' as NonEmpty,
  };
}

function requirement(
  id: string,
  partial: Partial<LexiconPathRequirement> & {
    requirementKind: LexiconPathRequirement['requirementKind'];
    requirementRef: NonEmpty;
  }
): LexiconPathRequirement {
  return {
    requirementId: id as NonEmpty,
    pathId: partial.pathId ?? ('p:x' as NonEmpty),
    requirementKind: partial.requirementKind,
    requirementRef: partial.requirementRef,
    required: partial.required ?? true,
    checkbackIfMissing: partial.checkbackIfMissing ?? true,
    ...(partial.failureCode !== undefined ? { failureCode: partial.failureCode } : {}),
    createdAt: NOW,
    mutationId: 'm-req' as NonEmpty,
  };
}

const ALL_SATISFIED = (): boolean => true;
const ALL_MISSING = (): boolean => false;

describe('path-id builder', () => {
  it('PATH-ID-01: emits prefix:ref for known kinds', () => {
    expect(buildPathId('task_intent', 'inventory.adjust_from_receiving')).toBe(
      'planner_task_intent:inventory.adjust_from_receiving'
    );
    expect(buildPathId('workflow_template', 'workflow_inventory_adjust_from_receiving_v1')).toBe(
      'planner_workflow_template:workflow_inventory_adjust_from_receiving_v1'
    );
    expect(buildPathId('entity', 'verb_pull')).toBe('lexicon_entity:verb_pull');
    expect(buildPathId('alias_rule', 'drop table')).toBe('planner_alias_rule:drop table');
  });

  it('PATH-ID-02: throws on empty ref', () => {
    expect(() => buildPathId('task_intent', '')).toThrow(/PATH_ID_BUILD_EMPTY_REF/);
  });

  it('PATH-ID-03: throws on ref containing colon', () => {
    expect(() => buildPathId('task_intent', 'foo:bar')).toThrow(/PATH_ID_BUILD_REF_HAS_COLON/);
  });

  it('PATH-ID-04: workflow node uses template/node separator', () => {
    expect(
      buildWorkflowNodePathId('workflow_inventory_adjust_from_receiving_v1', 'read_inventory')
    ).toBe('planner_workflow_node:workflow_inventory_adjust_from_receiving_v1/read_inventory');
  });

  it('PATH-ID-05: workflow node rejects empty parts', () => {
    expect(() => buildWorkflowNodePathId('', 'x')).toThrow(/EMPTY_TEMPLATE_OR_NODE/);
    expect(() => buildWorkflowNodePathId('x', '')).toThrow(/EMPTY_TEMPLATE_OR_NODE/);
  });

  it('PATH-ID-06: workflow node rejects colon or slash in either part', () => {
    expect(() => buildWorkflowNodePathId('a:b', 'c')).toThrow(/HAS_COLON/);
    expect(() => buildWorkflowNodePathId('a', 'c:d')).toThrow(/HAS_COLON/);
    expect(() => buildWorkflowNodePathId('a/b', 'c')).toThrow(/HAS_SLASH/);
    expect(() => buildWorkflowNodePathId('a', 'c/d')).toThrow(/HAS_SLASH/);
  });

  it('PATH-ID-07: deterministic (same input → same output)', () => {
    const a = buildPathId('task_intent', 'foo.bar');
    const b = buildPathId('task_intent', 'foo.bar');
    expect(a).toBe(b);
  });
});

describe('scorer — rule 1 (profile missing)', () => {
  it('PATH-SCORE-01: unknown path → unsupported_path with confidence/completeness=0, likelihood=1', () => {
    const result = scorePath({
      pathId: 'planner_task_intent:unknown' as NonEmpty,
      profile: null,
      evidence: [],
      contradictions: [],
      requirements: [],
      checkbackTemplates: [template('tpl-unsup', 'unsupported_path')],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('unsupported_path');
    expect(result.confidenceScore).toBe(0);
    expect(result.completenessScore).toBe(0);
    expect(result.failureLikelihood).toBe(1);
    expect(result.checkbackTemplateId).toBe('tpl-unsup');
  });
});

describe('scorer — rule 2 (blocked path)', () => {
  it('PATH-SCORE-02: profile.promotionStatus="blocked" → blocked_path', () => {
    const result = scorePath({
      pathId: 'planner_alias_rule:drop_table' as NonEmpty,
      profile: makeProfile({
        pathId: 'planner_alias_rule:drop_table' as NonEmpty,
        pathKind: 'alias_rule',
        promotionStatus: 'blocked',
        confidenceScore: 0.95,
      }),
      evidence: [],
      contradictions: [],
      requirements: [],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('blocked_path');
    expect(result.confidenceScore).toBe(0.95);
  });
});

describe('scorer — rules 3+4 (contradictions)', () => {
  it('PATH-SCORE-03: open critical contradiction → contradicted_path', () => {
    const result = scorePath({
      pathId: 'planner_task_intent:risky' as NonEmpty,
      profile: makeProfile({ pathId: 'planner_task_intent:risky' as NonEmpty }),
      evidence: [],
      contradictions: [contradiction('c-1', { severity: 'critical', resolverStatus: 'open' })],
      requirements: [],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('contradicted_path');
    expect(result.openContradictions).toEqual(['c-1']);
  });

  it('PATH-SCORE-04: open high-severity contradiction → contradicted_path', () => {
    const result = scorePath({
      pathId: 'planner_task_intent:risky2' as NonEmpty,
      profile: makeProfile({ pathId: 'planner_task_intent:risky2' as NonEmpty }),
      evidence: [],
      contradictions: [contradiction('c-2', { severity: 'high', resolverStatus: 'open' })],
      requirements: [],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('contradicted_path');
  });

  it('PATH-SCORE-05: open low/medium contradiction does NOT block (no critical)', () => {
    const result = scorePath({
      pathId: 'planner_task_intent:mild' as NonEmpty,
      profile: makeProfile({ pathId: 'planner_task_intent:mild' as NonEmpty }),
      evidence: [],
      contradictions: [
        contradiction('c-low', { severity: 'low', resolverStatus: 'open' }),
        contradiction('c-med', { severity: 'medium', resolverStatus: 'open' }),
      ],
      requirements: [],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('executable');
    expect(result.openContradictions.length).toBe(2);
  });

  it('PATH-SCORE-06: owner_ruling_required contradiction → typed_checkback', () => {
    const result = scorePath({
      pathId: 'planner_task_intent:owner_ruling' as NonEmpty,
      profile: makeProfile({ pathId: 'planner_task_intent:owner_ruling' as NonEmpty }),
      evidence: [],
      contradictions: [
        contradiction('c-or', {
          severity: 'low',
          resolverStatus: 'owner_ruling_required',
        }),
      ],
      requirements: [],
      checkbackTemplates: [template('tpl-unsup', 'unsupported_path')],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('typed_checkback');
    expect(result.checkbackTemplateId).toBe('tpl-unsup');
  });
});

describe('scorer — rule 5 (missing requirements)', () => {
  it('PATH-SCORE-07: missing connector with checkback template → typed_checkback (missing_connector)', () => {
    const pathId = 'planner_workflow_template:mail_send_v1' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({ pathId }),
      evidence: [],
      contradictions: [],
      requirements: [
        requirement('r-1', {
          pathId,
          requirementKind: 'connector',
          requirementRef: 'mailpit-local' as NonEmpty,
          required: true,
          checkbackIfMissing: true,
          failureCode: 'missing_connector:mailpit-local' as NonEmpty,
        }),
      ],
      checkbackTemplates: [template('tpl-mc', 'missing_connector')],
      satisfiesRequirement: ALL_MISSING,
    });
    expect(result.outcome).toBe('typed_checkback');
    expect(result.checkbackTemplateId).toBe('tpl-mc');
    expect(result.missingRequirements.length).toBe(1);
    expect(result.missingRequirements[0]!.requirementKind).toBe('connector');
    expect(result.missingRequirements[0]!.failureCode).toBe('missing_connector:mailpit-local');
  });

  it('PATH-SCORE-08: missing agent with checkback template → typed_checkback (missing_agent)', () => {
    const pathId = 'planner_task_intent:agentic' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({ pathId }),
      evidence: [],
      contradictions: [],
      requirements: [
        requirement('r-ag', {
          pathId,
          requirementKind: 'agent',
          requirementRef: 'agent-claude-001' as NonEmpty,
        }),
      ],
      checkbackTemplates: [template('tpl-ma', 'missing_agent')],
      satisfiesRequirement: ALL_MISSING,
    });
    expect(result.outcome).toBe('typed_checkback');
    expect(result.checkbackTemplateId).toBe('tpl-ma');
  });

  it('PATH-SCORE-09: missing required req with NO matching template → unsupported_path', () => {
    const pathId = 'planner_task_intent:no_template' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({ pathId }),
      evidence: [],
      contradictions: [],
      requirements: [
        requirement('r-nt', {
          pathId,
          requirementKind: 'connector',
          requirementRef: 'foo' as NonEmpty,
        }),
      ],
      checkbackTemplates: [], // no template
      satisfiesRequirement: ALL_MISSING,
    });
    expect(result.outcome).toBe('unsupported_path');
    expect(result.checkbackTemplateId).toBeNull();
    expect(result.missingRequirements.length).toBe(1);
  });

  it('PATH-SCORE-10: optional missing requirement does NOT block', () => {
    const pathId = 'planner_task_intent:opt' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({ pathId }),
      evidence: [],
      contradictions: [],
      requirements: [
        requirement('r-opt', {
          pathId,
          requirementKind: 'connector',
          requirementRef: 'optional-thing' as NonEmpty,
          required: false,
        }),
      ],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_MISSING,
    });
    expect(result.outcome).toBe('executable');
    expect(result.missingRequirements.length).toBe(0);
  });
});

describe('scorer — rule 6 (low confidence)', () => {
  it('PATH-SCORE-11: confidence < MIN → typed_checkback (ambiguous_intent)', () => {
    const pathId = 'planner_task_intent:fuzzy' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({
        pathId,
        confidenceScore: MIN_EXECUTABLE_CONFIDENCE - 0.1,
      }),
      evidence: [],
      contradictions: [],
      requirements: [],
      checkbackTemplates: [template('tpl-amb', 'ambiguous_intent')],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('typed_checkback');
    expect(result.checkbackTemplateId).toBe('tpl-amb');
  });
});

describe('scorer — rule 8 (likely failure)', () => {
  it('PATH-SCORE-12: failureLikelihood > MAX → likely_failure', () => {
    const pathId = 'planner_task_intent:fragile' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({
        pathId,
        failureLikelihood: MAX_EXECUTABLE_FAILURE_LIKELIHOOD + 0.1,
      }),
      evidence: [],
      contradictions: [],
      requirements: [],
      checkbackTemplates: [template('tpl-lf', 'likely_run_failure')],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('likely_failure');
    expect(result.checkbackTemplateId).toBe('tpl-lf');
  });
});

describe('scorer — rule 9 (executable)', () => {
  it('PATH-SCORE-13: confirmed profile, no contradictions, satisfied reqs → executable', () => {
    const pathId = 'planner_task_intent:happy_path' as NonEmpty;
    const result = scorePath({
      pathId,
      profile: makeProfile({ pathId, confidenceScore: 0.95, failureLikelihood: 0.02 }),
      evidence: [evidence('e-1', pathId)],
      contradictions: [],
      requirements: [
        requirement('r-cap', {
          pathId,
          requirementKind: 'capability',
          requirementRef: 'mail.compose_send' as NonEmpty,
        }),
      ],
      checkbackTemplates: [],
      satisfiesRequirement: ALL_SATISFIED,
    });
    expect(result.outcome).toBe('executable');
    expect(result.checkbackTemplateId).toBeNull();
    expect(result.missingRequirements).toEqual([]);
    expect(result.evidenceRefs).toEqual(['e-1']);
  });
});

describe('scorer — determinism', () => {
  it('PATH-SCORE-14: same input → same result (deterministic)', () => {
    const pathId = 'planner_task_intent:det' as NonEmpty;
    const input = {
      pathId,
      profile: makeProfile({ pathId }),
      evidence: [evidence('e-d1', pathId), evidence('e-d2', pathId)],
      contradictions: [],
      requirements: [
        requirement('r-1', {
          pathId,
          requirementKind: 'connector',
          requirementRef: 'x' as NonEmpty,
        }),
        requirement('r-2', {
          pathId,
          requirementKind: 'agent',
          requirementRef: 'a' as NonEmpty,
        }),
      ],
      checkbackTemplates: [
        template('tpl-ma', 'missing_agent'),
        template('tpl-mc', 'missing_connector'),
      ],
      satisfiesRequirement: (r: LexiconPathRequirement) => r.requirementKind === 'agent', // connector missing
    };
    const r1 = scorePath(input);
    const r2 = scorePath(input);
    expect(r1).toEqual(r2);
    expect(r1.outcome).toBe('typed_checkback');
    expect(r1.checkbackTemplateId).toBe('tpl-mc');
  });
});
