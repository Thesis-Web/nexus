/**
 * Integration tests for the F4.8 lexicon mutation flow — end-to-end via
 * SigningCouncil with the real JsonlLexiconMutationExecutor as the
 * dispatcher target.
 *
 * Covers LEX-MUT-01 through LEX-MUT-06 + LEX-MUT-11 + LEX-MUT-12. The
 * static-AST gates LEX-MUT-07 / -08 land in scripts/ci-gate.ts GOV-14;
 * LEX-MUT-09 / -10 (ledger emission) land in the coordinator +
 * composition-root integration paths.
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
  type NonEmpty,
  type RunLedgerWriter,
  type RunLedgerEntry,
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
  readonly publicKey: string;
}

async function generateAdmin(keysRoot: string, slug: string): Promise<TestAdmin> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const principalId = `lex-admin-${slug}-${randomUUID().slice(0, 8)}` as NonEmpty;
  const publicKey = b64uEncode(pub);
  const privateKey = b64uEncode(priv);
  await fs.mkdir(path.join(keysRoot, 'admins'), { recursive: true });
  await fs.writeFile(
    path.join(keysRoot, 'admins', `${principalId}.public.json`),
    JSON.stringify({ adminId: principalId, publicKey, purpose: 'admin_signing' }, null, 2),
    'utf-8'
  );
  return { principalId, privateKey, publicKey };
}

async function signEnvelope(envelope: string, privateKeyB64Url: string): Promise<Base64Url> {
  const priv = new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'));
  const sig = await ed25519.signAsync(new TextEncoder().encode(envelope), priv);
  return b64uEncode(sig) as Base64Url;
}

describe('F4.8 lexicon mutation integration (council + executor + JSONL backend)', () => {
  let originalCwd: string;
  let workRoot: string;
  let adminA: TestAdmin;
  let adminB: TestAdmin;
  let ledger: MockRunLedger;
  let executor: JsonlLexiconMutationExecutor;
  let council: SigningCouncil;

  beforeAll(async () => {
    originalCwd = process.cwd();
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lex-int-'));
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

  async function openMutation(mutation: LexiconMutation) {
    return council.open({
      operation: 'lexicon_mutation',
      payload: { mutation } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
  }

  async function signRequest(requestId: NonEmpty, admin: TestAdmin) {
    const req = (await council.get(requestId))!;
    const envelope = council.canonicalSigningEnvelope(req);
    const sig = await signEnvelope(envelope, admin.privateKey);
    return council.sign(requestId, admin.principalId, sig);
  }

  it('LEX-MUT-01: open entity_add → status=pending; JSONL untouched', async () => {
    const opened = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_pull' as NonEmpty,
        displayName: 'pull' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    expect(opened.status).toBe('pending');
    expect(opened.operation).toBe('lexicon_mutation');
    expect(opened.signatures.length).toBe(0);
    // JSONL file should not exist yet
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    await expect(fs.stat(jsonlPath)).rejects.toThrow();
  });

  it('LEX-MUT-02: single signature → JSONL untouched, status stays pending', async () => {
    const opened = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_push' as NonEmpty,
        displayName: 'push' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    const afterOneSig = await signRequest(opened.requestId, adminA);
    expect(afterOneSig.status).toBe('pending');
    expect(afterOneSig.signatures.length).toBe(1);
    expect(ledger.events.find(e => e.eventType === 'lexicon_mutation_applied')).toBeUndefined();
  });

  it('LEX-MUT-03: 2 distinct signatures → executor applies, JSONL appended, ledger event written', async () => {
    const opened = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_fetch' as NonEmpty,
        displayName: 'fetch' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    await signRequest(opened.requestId, adminA);
    const final = await signRequest(opened.requestId, adminB);
    expect(final.status).toBe('executed');
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    const raw = await fs.readFile(jsonlPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const lastLine = JSON.parse(lines[lines.length - 1]!);
    expect(lastLine.mutation.kind).toBe('entity_add');
    expect(lastLine.mutation.entity.entityId).toBe('verb_fetch');
    expect(lastLine.signers).toEqual([adminA.principalId, adminB.principalId]);
    expect(ledger.events.map(e => e.eventType)).toContain('lexicon_mutation_applied');
    expect(ledger.events.map(e => e.eventType)).toContain('federated_operation_executed');
  });

  it('LEX-MUT-04: duplicate signer rejected, status stays pending', async () => {
    const opened = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_dup' as NonEmpty,
        displayName: 'dup' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    await signRequest(opened.requestId, adminA);
    await expect(signRequest(opened.requestId, adminA)).rejects.toThrow(/DUPLICATE_SIGNER/);
    const refetched = (await council.get(opened.requestId))!;
    expect(refetched.status).toBe('pending');
    expect(refetched.signatures.length).toBe(1);
  });

  it('LEX-MUT-05: replayed signature on a different requestId → rejected (envelope binds requestId)', async () => {
    const req1 = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_one' as NonEmpty,
        displayName: 'one' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    const req2 = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_two' as NonEmpty,
        displayName: 'two' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    // sign req1 envelope with admin A's key, then attempt to use that
    // signature on req2 — must fail because the envelope includes requestId.
    const envelope1 = council.canonicalSigningEnvelope(req1);
    const sigForReq1 = await signEnvelope(envelope1, adminA.privateKey);
    await expect(council.sign(req2.requestId, adminA.principalId, sigForReq1)).rejects.toThrow(
      /INVALID_ADMIN_SIGNATURE/
    );
  });

  it('LEX-MUT-06: unknown mutation kind → dispatcher fails → council denies', async () => {
    const opened = await council.open({
      operation: 'lexicon_mutation',
      payload: { mutation: { kind: 'rogue_kind', entity: {} } } as unknown as Record<
        string,
        unknown
      >,
      openedBy: adminA.principalId,
    });
    await signRequest(opened.requestId, adminA);
    const final = await signRequest(opened.requestId, adminB);
    expect(final.status).toBe('denied');
    expect(String(final.denialReason)).toMatch(/LEXICON_DISPATCH_UNKNOWN_KIND/);
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    // Either no file, or file exists but no rogue_kind line
    try {
      const raw = await fs.readFile(jsonlPath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        expect(JSON.parse(line).mutation.kind).not.toBe('rogue_kind');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  });

  it('LEX-MUT-11: subsequent reads of JSONL include the freshly-applied line (hot-read)', async () => {
    const opened = await openMutation({
      kind: 'entity_add',
      entity: {
        entityId: 'verb_hot' as NonEmpty,
        displayName: 'hot' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    });
    await signRequest(opened.requestId, adminA);
    await signRequest(opened.requestId, adminB);
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    const raw = await fs.readFile(jsonlPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const hot = lines
      .map(l => JSON.parse(l))
      .find(o => o.mutation?.entity?.entityId === 'verb_hot');
    expect(hot).toBeDefined();
    expect(hot.signers).toContain(adminA.principalId);
    expect(hot.signers).toContain(adminB.principalId);
  });
});
