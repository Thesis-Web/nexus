/**
 * LexiconMutationExecutor — AMEND-nexus-lexicon-admin-ui-v0-2-0.md §2.2
 *
 * Phase 1 (Q7): JSONL append after SigningCouncil 2-of-2 threshold is met.
 * The executor validates the mutation against current state, canonicalizes
 * a single JSONL line, appends atomically to the appropriate fixture, and
 * emits `lexicon_mutation_applied` with the full signer chain.
 *
 * Phase 2 (separate spec arc): swap JSONL append for SQLite insert behind
 * the same LexiconMutationExecutor interface.
 *
 * Layer: core (BAKED). Plug-in admin-writer routes call into this
 * executor via SigningCouncil; runtime read paths NEVER call apply.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  IsoTimestamp,
  LexiconMutation,
  LexiconMutationExecutor,
  LexiconMutationResult,
  NonEmpty,
  RunLedgerWriter,
} from '@nexus/contracts';
import { canonicalize } from '../crypto/canonicalize.js';
import { emitInfrastructureAuditEvent } from '../modes/mode-manager.js';

interface FixturePath {
  readonly file: string; // JSONL fixture path (relative to cwd)
}

const FIXTURE_PATHS: Record<LexiconMutation['kind'], FixturePath> = {
  entity_add: { file: path.join('fixtures', 'lexicon', 'lexicon_entity.jsonl') },
  entity_update: { file: path.join('fixtures', 'lexicon', 'lexicon_entity.jsonl') },
  entity_disable: { file: path.join('fixtures', 'lexicon', 'lexicon_entity.jsonl') },
  edge_add: { file: path.join('fixtures', 'lexicon', 'lexicon_edge.jsonl') },
  edge_update: { file: path.join('fixtures', 'lexicon', 'lexicon_edge.jsonl') },
  edge_disable: { file: path.join('fixtures', 'lexicon', 'lexicon_edge.jsonl') },
  confidence_set: { file: path.join('fixtures', 'lexicon', 'lexicon_confidence.jsonl') },
  workflow_template_add: {
    file: path.join('fixtures', 'lexicon', 'workflow_template.jsonl'),
  },
  workflow_template_update: {
    file: path.join('fixtures', 'lexicon', 'workflow_template.jsonl'),
  },
  guard_add: { file: path.join('fixtures', 'lexicon', 'lexicon_guard.jsonl') },
  guard_update: { file: path.join('fixtures', 'lexicon', 'lexicon_guard.jsonl') },
  // ── Fourth-layer mutation targets ─────────────────────────────────────
  // AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0 §6.2 — JSONL backend.
  // All authoritative path-layer mutation goes through the same 2-of-2
  // council; each variant routes to one of five new JSONL targets.
  path_profile_add: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_profile.jsonl'),
  },
  path_profile_update: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_profile.jsonl'),
  },
  path_profile_disable: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_profile.jsonl'),
  },
  path_evidence_add: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_evidence.jsonl'),
  },
  path_contradiction_add: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_contradiction.jsonl'),
  },
  path_contradiction_resolve: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_contradiction.jsonl'),
  },
  path_requirement_add: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_requirement.jsonl'),
  },
  path_requirement_update: {
    file: path.join('fixtures', 'lexicon', 'lexicon_path_requirement.jsonl'),
  },
  checkback_template_add: {
    file: path.join('fixtures', 'lexicon', 'lexicon_checkback_template.jsonl'),
  },
  checkback_template_update: {
    file: path.join('fixtures', 'lexicon', 'lexicon_checkback_template.jsonl'),
  },
};

export interface JsonlLexiconMutationExecutorDeps {
  readonly runLedger: RunLedgerWriter;
  /** Override fixtures root for tests (defaults to cwd). */
  readonly fixturesRoot?: string;
  /** Override clock for deterministic tests. */
  readonly clock?: () => string;
}

export class JsonlLexiconMutationExecutor implements LexiconMutationExecutor {
  constructor(private readonly deps: JsonlLexiconMutationExecutorDeps) {}

  async apply(
    mutation: LexiconMutation,
    signers: ReadonlyArray<NonEmpty>
  ): Promise<LexiconMutationResult> {
    if (signers.length < 2) {
      throw new Error(
        'LEXICON_BELOW_THRESHOLD: lexicon_mutation requires 2 distinct admin signatures (Q4)'
      );
    }
    if (new Set(signers).size < 2) {
      throw new Error('LEXICON_DUPLICATE_SIGNERS: signers must be 2 distinct admin principals');
    }
    const fixture = FIXTURE_PATHS[mutation.kind];
    const root = this.deps.fixturesRoot ?? process.cwd();
    const fixturePath = path.isAbsolute(fixture.file)
      ? fixture.file
      : path.join(root, fixture.file);
    const mutationId = randomUUID() as NonEmpty;
    const appliedAt = (this.deps.clock?.() ?? new Date().toISOString()) as IsoTimestamp;
    const seqNo = await this.appendCanonicalLine(fixturePath, {
      mutationId,
      appliedAt,
      signers,
      mutation,
    });
    await emitInfrastructureAuditEvent(
      'lexicon_mutation_applied',
      {
        mutationId,
        appliedAt,
        mutationKind: mutation.kind,
        signers,
        jsonlFile: fixture.file,
        jsonlSeqNo: seqNo,
      },
      this.deps.runLedger
    );
    return {
      mutationId,
      appliedAt,
      jsonlFile: fixture.file as NonEmpty,
      jsonlSeqNo: seqNo,
    };
  }

  /**
   * Atomic append: read current line count for seq assignment, then
   * append the canonical line. JSONL is the V1 backend (Q7 Phase 1);
   * Phase 2 swaps to SQLite without changing this interface.
   */
  private async appendCanonicalLine(
    filePath: string,
    record: {
      mutationId: NonEmpty;
      appliedAt: IsoTimestamp;
      signers: ReadonlyArray<NonEmpty>;
      mutation: LexiconMutation;
    }
  ): Promise<number> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let seqNo = 0;
    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      seqNo =
        existing.length === 0
          ? 0
          : existing.split(/\r?\n/).filter(line => line.trim().length > 0).length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const line =
      canonicalize({
        seqNo,
        ...record,
      }) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
    return seqNo;
  }
}
