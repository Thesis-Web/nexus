/**
 * lexicon-arena-mutation.integration.test.ts
 *
 * Integration coverage for the fourth-layer mutation variants added by
 * AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0.md §6.1: each new
 * `LexiconMutation` kind round-trips through SigningCouncil 2-of-2 +
 * `buildLexiconMutationDispatcher` + `JsonlLexiconMutationExecutor`,
 * lands in the spec-correct fixtures/lexicon/lexicon_path_*.jsonl
 * file, and emits `lexicon_mutation_applied` to the run ledger.
 *
 * Complements the existing
 * `packages/core/src/lexicon/lexicon-mutation.integration.test.ts`
 * (which covers the first ten LexiconMutation kinds) — same harness
 * shape, different mutation kinds.
 *
 * LEX-ARENA-01 path_profile_add        → lexicon_path_profile.jsonl
 * LEX-ARENA-02 path_evidence_add       → lexicon_path_evidence.jsonl
 * LEX-ARENA-03 path_contradiction_add  → lexicon_path_contradiction.jsonl
 * LEX-ARENA-04 path_requirement_add    → lexicon_path_requirement.jsonl
 * LEX-ARENA-05 checkback_template_add  → lexicon_checkback_template.jsonl
 * LEX-ARENA-06 path_profile_update     → lexicon_path_profile.jsonl (same file as add)
 * LEX-ARENA-07 unknown path-layer kind → dispatcher denies the request
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Buffer } from 'node:buffer';
import {
  type Base64Url,
  type LexiconMutation,
  type LexiconPathProfile,
  type LexiconPathEvidence,
  type LexiconPathContradiction,
  type LexiconPathRequirement,
  type LexiconCheckbackTemplate,
  type NonEmpty,
  type RunLedgerWriter,
  type RunLedgerEntry,
  type IsoTimestamp,
} from '@nexus/contracts';
import { SigningCouncil, InMemorySigningCouncilRequestStore } from '../signing/signing-council.js';
import { buildLexiconMutationDispatcher } from '../signing/signing-council-dispatchers.js';
import { JsonlLexiconMutationExecutor } from './lexicon-mutation-executor.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

class MockRunLedger implements RunLedgerWriter {
  public events: RunLedgerEntry[] = [];
  async writeEvent(e: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    this.events.push({ ...e, entryId: randomUUID() as never });
  }
}

interface TestAdmin {
  readonly principalId: NonEmpty;
  readonly privateKey: string;
}

async function generateAdmin(keysRoot: string, slug: string): Promise<TestAdmin> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const principalId = `arena-admin-${slug}-${randomUUID().slice(0, 8)}` as NonEmpty;
  const publicKey = b64uEncode(pub);
  const privateKey = b64uEncode(priv);
  await fs.mkdir(path.join(keysRoot, 'admins'), { recursive: true });
  await fs.writeFile(
    path.join(keysRoot, 'admins', `${principalId}.public.json`),
    JSON.stringify({ adminId: principalId, publicKey, purpose: 'admin_signing' }, null, 2),
    'utf-8'
  );
  return { principalId, privateKey };
}

async function signEnvelope(envelope: string, privateKeyB64Url: string): Promise<Base64Url> {
  const priv = new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'));
  const sig = await ed25519.signAsync(new TextEncoder().encode(envelope), priv);
  return b64uEncode(sig) as Base64Url;
}

function nowIso(): IsoTimestamp {
  return new Date('2026-05-22T12:00:00.000Z').toISOString() as IsoTimestamp;
}

describe('AMEND lexicon-arena-evidence-layer §6 — fourth-layer mutation integration', () => {
  let originalCwd: string;
  let workRoot: string;
  let adminA: TestAdmin;
  let adminB: TestAdmin;
  let ledger: MockRunLedger;
  let executor: JsonlLexiconMutationExecutor;
  let council: SigningCouncil;

  beforeAll(async () => {
    originalCwd = process.cwd();
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lex-arena-int-'));
    process.chdir(workRoot);
    adminA = await generateAdmin('keys', 'a');
    adminB = await generateAdmin('keys', 'b');
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    ledger = new MockRunLedger();
    executor = new JsonlLexiconMutationExecutor({
      runLedger: ledger,
      fixturesRoot: workRoot,
    });
    council = new SigningCouncil({
      store: new InMemorySigningCouncilRequestStore(),
      runLedger: ledger,
      dispatchers: {
        lexicon_mutation: buildLexiconMutationDispatcher(executor),
      },
    });
  });

  async function openAndExecute(mutation: LexiconMutation) {
    const opened = await council.open({
      operation: 'lexicon_mutation',
      payload: { mutation } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    const envelope = council.canonicalSigningEnvelope(opened);
    const sigA = await signEnvelope(envelope, adminA.privateKey);
    const sigB = await signEnvelope(envelope, adminB.privateKey);
    await council.sign(opened.requestId, adminA.principalId, sigA);
    return council.sign(opened.requestId, adminB.principalId, sigB);
  }

  async function readJsonl(filename: string): Promise<ReadonlyArray<Record<string, unknown>>> {
    const filePath = path.join(workRoot, 'fixtures', 'lexicon', filename);
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as Record<string, unknown>);
  }

  it('LEX-ARENA-01: path_profile_add → lexicon_path_profile.jsonl + lexicon_mutation_applied', async () => {
    const profile: LexiconPathProfile = {
      pathId: 'planner_task_intent:inventory.adjust_from_receiving' as NonEmpty,
      pathKind: 'task_intent',
      sourceRef: 'planner_task_intent:inventory.adjust_from_receiving' as NonEmpty,
      arenaId: 'lex-arena-test' as NonEmpty,
      confidenceScore: 0.9,
      completenessScore: 1,
      failureLikelihood: 0.05,
      promotionStatus: 'confirmed',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    const final = await openAndExecute({ kind: 'path_profile_add', profile });
    expect(final.status).toBe('executed');
    const lines = await readJsonl('lexicon_path_profile.jsonl');
    expect(lines.length).toBe(1);
    const last = lines[0]!;
    const lastMutation = last['mutation'] as { kind: string; profile: LexiconPathProfile };
    expect(lastMutation.kind).toBe('path_profile_add');
    expect(lastMutation.profile.pathId).toBe(profile.pathId);
    expect(last['signers']).toEqual([adminA.principalId, adminB.principalId]);
    expect(ledger.events.map(e => e.eventType)).toContain('lexicon_mutation_applied');
  });

  it('LEX-ARENA-02: path_evidence_add → lexicon_path_evidence.jsonl', async () => {
    const evidence: LexiconPathEvidence = {
      evidenceId: ('ev-' + randomUUID()) as NonEmpty,
      pathId: 'planner_task_intent:inventory.adjust_from_receiving' as NonEmpty,
      evidenceKind: 'blueprint_pin',
      sourceRef: 'docs/blueprints/AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0.md' as NonEmpty,
      sourceDigest: 'sha256-fixture-digest-arena-02' as NonEmpty,
      independenceGroup: 'blueprint:arena-v0-1-0' as NonEmpty,
      confidenceDelta: 0.2,
      evidenceSummary: 'arena spec ratifies fourth-layer path-evidence schema' as NonEmpty,
      createdAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    const final = await openAndExecute({ kind: 'path_evidence_add', evidence });
    expect(final.status).toBe('executed');
    const lines = await readJsonl('lexicon_path_evidence.jsonl');
    expect(lines.length).toBe(1);
    const lastMutation = lines[0]!['mutation'] as { kind: string; evidence: LexiconPathEvidence };
    expect(lastMutation.kind).toBe('path_evidence_add');
    expect(lastMutation.evidence.evidenceKind).toBe('blueprint_pin');
  });

  it('LEX-ARENA-03: path_contradiction_add → lexicon_path_contradiction.jsonl', async () => {
    const contradiction: LexiconPathContradiction = {
      contradictionId: ('contra-' + randomUUID()) as NonEmpty,
      pathIdA: 'planner_alias_rule:drop_table' as NonEmpty,
      pathIdB: 'planner_alias_rule:delete_everything' as NonEmpty,
      contradictionKind: 'governance_class_conflict',
      severity: 'critical',
      resolverStatus: 'open',
      summary: 'two blocked alias paths converge on a forbidden capability' as NonEmpty,
      createdAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    const final = await openAndExecute({ kind: 'path_contradiction_add', contradiction });
    expect(final.status).toBe('executed');
    const lines = await readJsonl('lexicon_path_contradiction.jsonl');
    expect(lines.length).toBe(1);
    const lastMutation = lines[0]!['mutation'] as {
      kind: string;
      contradiction: LexiconPathContradiction;
    };
    expect(lastMutation.kind).toBe('path_contradiction_add');
    expect(lastMutation.contradiction.severity).toBe('critical');
  });

  it('LEX-ARENA-04: path_requirement_add → lexicon_path_requirement.jsonl', async () => {
    const requirement: LexiconPathRequirement = {
      requirementId: ('req-' + randomUUID()) as NonEmpty,
      pathId: 'planner_workflow_template:workflow_mail_compose_v1' as NonEmpty,
      requirementKind: 'connector',
      requirementRef: 'mailpit-local' as NonEmpty,
      required: true,
      checkbackIfMissing: true,
      failureCode: 'missing_connector:mailpit-local' as NonEmpty,
      createdAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    const final = await openAndExecute({ kind: 'path_requirement_add', requirement });
    expect(final.status).toBe('executed');
    const lines = await readJsonl('lexicon_path_requirement.jsonl');
    expect(lines.length).toBe(1);
    const lastMutation = lines[0]!['mutation'] as {
      kind: string;
      requirement: LexiconPathRequirement;
    };
    expect(lastMutation.kind).toBe('path_requirement_add');
    expect(lastMutation.requirement.requirementKind).toBe('connector');
  });

  it('LEX-ARENA-05: checkback_template_add → lexicon_checkback_template.jsonl', async () => {
    const template: LexiconCheckbackTemplate = {
      templateId: ('tpl-' + randomUUID()) as NonEmpty,
      checkbackKind: 'missing_connector',
      promptTitle: 'No mail connector configured' as NonEmpty,
      operatorQuestion: 'No outbound mail connector is enabled. Set one up or cancel?' as NonEmpty,
      safeOptionsJson: JSON.stringify([
        { option: 'open_admin_setup', label: 'Open admin → Connectors' },
        { option: 'cancel', label: 'Cancel run' },
      ]) as NonEmpty,
      defaultAction: 'cancel',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    const final = await openAndExecute({ kind: 'checkback_template_add', template });
    expect(final.status).toBe('executed');
    const lines = await readJsonl('lexicon_checkback_template.jsonl');
    expect(lines.length).toBe(1);
    const lastMutation = lines[0]!['mutation'] as {
      kind: string;
      template: LexiconCheckbackTemplate;
    };
    expect(lastMutation.kind).toBe('checkback_template_add');
    expect(lastMutation.template.checkbackKind).toBe('missing_connector');
  });

  it('LEX-ARENA-06: path_profile_update appends to the same lexicon_path_profile.jsonl', async () => {
    // First add — use a unique pathId per test so this assertion is
    // independent of any other test in this file (the JSONL is append-only
    // and shared across `beforeEach`).
    const profile: LexiconPathProfile = {
      pathId: 'planner_task_intent:mail.summarize_inbox' as NonEmpty,
      pathKind: 'task_intent',
      sourceRef: 'planner_task_intent:mail.summarize_inbox' as NonEmpty,
      arenaId: 'lex-arena-test' as NonEmpty,
      confidenceScore: 0.5,
      completenessScore: 0.8,
      failureLikelihood: 0.3,
      promotionStatus: 'candidate',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mutationId: ('m-' + randomUUID()) as NonEmpty,
    };
    await openAndExecute({ kind: 'path_profile_add', profile });

    // Update — same JSONL file, append-only
    await openAndExecute({
      kind: 'path_profile_update',
      pathId: profile.pathId,
      patch: {
        confidenceScore: 0.85,
        failureLikelihood: 0.1,
        promotionStatus: 'confirmed',
        updatedAt: '2026-05-22T13:00:00.000Z' as IsoTimestamp,
      },
    });

    const lines = await readJsonl('lexicon_path_profile.jsonl');
    // Filter to this test's path only — the file may carry lines from
    // earlier tests in this describe (shared workRoot, append-only file).
    const mineLines = lines
      .map(l => l['mutation'] as { kind: string; profile?: LexiconPathProfile; pathId?: string })
      .filter(m => {
        if (m.kind === 'path_profile_add') return m.profile?.pathId === profile.pathId;
        if (m.kind === 'path_profile_update') return m.pathId === profile.pathId;
        return false;
      });
    expect(mineLines.length).toBe(2);
    expect(mineLines[0]!.kind).toBe('path_profile_add');
    expect(mineLines[1]!.kind).toBe('path_profile_update');
    const updatePatch = (mineLines[1] as unknown as { patch: Partial<LexiconPathProfile> }).patch;
    expect(updatePatch.confidenceScore).toBe(0.85);
    expect(updatePatch.promotionStatus).toBe('confirmed');
  });

  it('LEX-ARENA-07: unknown path-layer kind → council denies (LEXICON_DISPATCH_UNKNOWN_KIND)', async () => {
    // Open a mutation with an invented kind. The council passes payload to
    // the dispatcher; the dispatcher rejects unknown kinds.
    const opened = await council.open({
      operation: 'lexicon_mutation',
      payload: {
        mutation: { kind: 'path_outcome_add', outcome: {} },
      } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    const envelope = council.canonicalSigningEnvelope(opened);
    const sigA = await signEnvelope(envelope, adminA.privateKey);
    const sigB = await signEnvelope(envelope, adminB.privateKey);
    await council.sign(opened.requestId, adminA.principalId, sigA);
    const final = await council.sign(opened.requestId, adminB.principalId, sigB);
    expect(final.status).toBe('denied');
    expect(String(final.denialReason)).toMatch(/LEXICON_DISPATCH_UNKNOWN_KIND/);
  });
});
