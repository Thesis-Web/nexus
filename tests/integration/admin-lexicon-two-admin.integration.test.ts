/**
 * admin-lexicon-two-admin.integration.test.ts
 *
 * Closes D-3 from `docs/acceptance-wall/MAILPIT-INTEGRATION-DRIFT-AUDIT-
 * 2026-05-22.md`: end-to-end proof that the admin dashboard HTTP path
 * opens a `lexicon_mutation` SigningCouncil request, requires two
 * **distinct** admin signatures, rejects duplicate same-admin
 * signatures, rejects invalid signature bytes, and on threshold-met
 * dispatches the mutation through `JsonlLexiconMutationExecutor.apply`
 * with the resulting state visible through the admin read surface.
 *
 * What this proves vs. the existing
 * `packages/core/src/lexicon/lexicon-mutation.integration.test.ts`:
 *   - existing test exercises `SigningCouncil` + executor through
 *     in-process method calls only;
 *   - this test drives the same flow through the production HTTP
 *     surface (`POST /workspace/admin/lexicon/entities` →
 *     `POST /workspace/admin/signing/requests/:id/signatures` →
 *     `GET /workspace/admin/lexicon/entities`), with a real Express
 *     server, the real admin-writer routes, the real council, the
 *     real executor, and a server-side signer that loads two distinct
 *     admin keypairs from disk (per
 *     `feedback_signing_keys_server_side`: the browser never holds
 *     the admin keypair; the server signs).
 *
 * Test cases:
 *   LEX-TWA-01 — open lexicon_mutation through HTTP returns 202 +
 *                pending + threshold=2 + requestId.
 *   LEX-TWA-02 — first admin signature leaves request pending; no
 *                JSONL write yet.
 *   LEX-TWA-03 — duplicate same-admin signature rejected (409
 *                DUPLICATE_SIGNER); request stays pending.
 *   LEX-TWA-04 — pre-supplied invalid signature bytes rejected (403
 *                INVALID_ADMIN_SIGNATURE); request stays pending.
 *   LEX-TWA-05 — second distinct admin signature executes the
 *                mutation: status=executed, JSONL line appended with
 *                both signers, run-ledger contains
 *                `lexicon_mutation_applied` + `federated_operation_*`
 *                events.
 *   LEX-TWA-06 — admin read surface (`GET /workspace/admin/lexicon/
 *                entities`) reflects the freshly-applied entity.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import {
  registerAdminWriterRoutes,
  type SigningCouncilServerSignerPort,
} from '../../packages/interfaces/api/src/routes/admin-writer.js';
import {
  SigningCouncil,
  InMemorySigningCouncilRequestStore,
} from '../../packages/core/src/signing/signing-council.js';
import { buildLexiconMutationDispatcher } from '../../packages/core/src/signing/signing-council-dispatchers.js';
import { JsonlLexiconMutationExecutor } from '../../packages/core/src/lexicon/lexicon-mutation-executor.js';
import { InMemoryInfraRunIdNamespace } from '../../packages/core/src/infra/infra-run-id-namespace.js';
import { InMemoryAdminMutationNonceStore } from '../../packages/interfaces/api/src/middleware/signed-admin-mutation.js';
import type {
  IdentityClaims,
  ElevatedAuthProvider,
  ElevatedAuthChallenge,
  ElevatedAuthChallengeRequest,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  ElevatedSessionStatus,
  AdminMutationVerifierPort,
  AdminMutationServerSignerPort,
  RunLedgerEntry,
  RunLedgerWriter,
  Uuid,
  NonEmpty,
  Base64Url,
  AdminMutationKind,
  SignedAdminMutation,
} from '../../packages/contracts/src/index.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

const ADMIN_PID_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const ADMIN_PID_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const ADMIN_AID_A = '33333333-3333-4333-8333-aaaaaaaaaaaa';
const ADMIN_AID_B = '44444444-4444-4444-8444-bbbbbbbbbbbb';
const VALID_ELEV_A = '55555555-5555-4555-8555-aaaaaaaaaaaa';
const VALID_ELEV_B = '66666666-6666-4666-8666-bbbbbbbbbbbb';

interface TestAdmin {
  readonly principalId: NonEmpty;
  readonly actorId: string;
  readonly elevatedSession: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

async function generateAdmin(
  keysRoot: string,
  principalId: string,
  actorId: string,
  elevatedSession: string
): Promise<TestAdmin> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const publicKey = b64uEncode(pub);
  const privateKey = b64uEncode(priv);
  const adminsDir = path.join(keysRoot, 'admins');
  await fs.mkdir(adminsDir, { recursive: true });
  await fs.writeFile(
    path.join(adminsDir, `${principalId}.public.json`),
    JSON.stringify({ adminId: principalId, publicKey, purpose: 'admin_signing' }, null, 2),
    'utf-8'
  );
  return {
    principalId: principalId as NonEmpty,
    actorId,
    elevatedSession,
    publicKey,
    privateKey,
  };
}

async function signEnvelope(envelope: string, privateKeyB64Url: string): Promise<Base64Url> {
  const priv = new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'));
  const sig = await ed25519.signAsync(new TextEncoder().encode(envelope), priv);
  return b64uEncode(sig) as Base64Url;
}

// ── Fake JWT middleware that switches identity per X-Test-Identity ─────────
function fakeJwtMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.header('X-Test-Identity');
  if (raw === undefined) {
    next();
    return;
  }
  const parsed = JSON.parse(raw) as {
    kind: 'admin' | 'plain';
    principalId: string;
    actorId: string;
  };
  const claims: IdentityClaims = {
    principalIdentity: ('Test:' + parsed.principalId) as NonEmpty,
    roleAssignments:
      parsed.kind === 'admin' ? (['nexus-admin'] as NonEmpty[]) : (['user'] as NonEmpty[]),
    capabilityCeilings: [
      {
        allowedSystems: ['*'],
        allowedCapabilities: ['*'],
        maxRiskTier: 'critical',
      },
    ],
    environmentContext: 'reference' as NonEmpty,
    actorClass: 'HUMAN',
  };
  res.locals['claims'] = claims;
  res.locals['principalId'] = parsed.principalId;
  res.locals['actorId'] = parsed.actorId;
  next();
}

class MockRunLedger implements RunLedgerWriter {
  public events: RunLedgerEntry[] = [];
  async writeEvent(e: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    this.events.push({ ...e, entryId: randomUUID() as never });
  }
  async getByRunId(): Promise<RunLedgerEntry[]> {
    return [];
  }
  async tail(): Promise<RunLedgerEntry[]> {
    return [];
  }
  async getLatestRunId(): Promise<Uuid | null> {
    return null;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
function adminHeaders(a: TestAdmin): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Test-Identity': JSON.stringify({
      kind: 'admin',
      principalId: a.principalId,
      actorId: a.actorId,
    }),
    'X-Elevated-Session': a.elevatedSession,
  };
}

interface SigningRequestSnapshot {
  readonly requestId: string;
  readonly operation: string;
  readonly status: 'pending' | 'executed' | 'denied' | 'expired';
  readonly signatures: ReadonlyArray<{ readonly principalId: string }>;
  readonly payloadDigest: string;
  readonly openedAt: string;
  readonly dispatchedAt?: string;
  readonly denialReason?: string;
}

describe('admin lexicon two-admin signing — end-to-end through admin dashboard HTTP API', () => {
  let originalCwd: string;
  let workRoot: string;
  let server: Server;
  let baseUrl: string;
  let adminA: TestAdmin;
  let adminB: TestAdmin;
  let ledger: MockRunLedger;
  let executor: JsonlLexiconMutationExecutor;
  let council: SigningCouncil;
  let app: Express;

  beforeAll(async () => {
    originalCwd = process.cwd();
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-lex-twa-'));
    process.chdir(workRoot);

    adminA = await generateAdmin(
      path.join(workRoot, 'keys'),
      ADMIN_PID_A,
      ADMIN_AID_A,
      VALID_ELEV_A
    );
    adminB = await generateAdmin(
      path.join(workRoot, 'keys'),
      ADMIN_PID_B,
      ADMIN_AID_B,
      VALID_ELEV_B
    );

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

    // Server-side signer that loads private keys from an in-memory map
    // keyed by principalId. Mirrors production behavior where the route
    // loads the elevated admin's keypair server-side and signs the
    // canonical envelope; browser never holds the keypair.
    const privKeyByPrincipal = new Map<string, string>([
      [adminA.principalId, adminA.privateKey],
      [adminB.principalId, adminB.privateKey],
    ]);
    const serverSigner: SigningCouncilServerSignerPort = {
      async signEnvelope(input): Promise<Base64Url> {
        const priv = privKeyByPrincipal.get(input.principalId);
        if (!priv) {
          throw Object.assign(new Error(`NO_KEYPAIR_FOR_PRINCIPAL:${input.principalId}`), {
            statusCode: 412,
          });
        }
        return signEnvelope(input.canonicalEnvelope, priv);
      },
    };

    // Elevated-auth provider that accepts either admin's elevated session
    // for that admin's principal id.
    const elevatedAuth: ElevatedAuthProvider = {
      async challenge(_req: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> {
        throw new Error('not used');
      },
      async verify(_req: ElevatedAuthVerifyRequest): Promise<ElevatedSession> {
        throw new Error('not used');
      },
      async validateSession(sessionId: Uuid, principalId: string): Promise<ElevatedSessionStatus> {
        if (
          (sessionId as string) === adminA.elevatedSession &&
          principalId === adminA.principalId
        ) {
          return { valid: true, remainingSeconds: 600 };
        }
        if (
          (sessionId as string) === adminB.elevatedSession &&
          principalId === adminB.principalId
        ) {
          return { valid: true, remainingSeconds: 600 };
        }
        return { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty };
      },
    };

    const passVerifier: AdminMutationVerifierPort = {
      async verify(envelope: SignedAdminMutation<unknown>) {
        return {
          ok: true,
          opener: envelope.opener,
          payloadDigest: 'fixture-digest',
          signatureRef: 'fixture-sigref',
        };
      },
    };
    const fixtureMutationSigner: AdminMutationServerSignerPort = {
      async sign<TPayload>(args: {
        opener: NonEmpty;
        mutationKind: AdminMutationKind;
        payload: TPayload;
        issuedAt: string;
        nonce: NonEmpty;
      }): Promise<SignedAdminMutation<TPayload>> {
        return {
          mutationKind: args.mutationKind,
          payload: args.payload,
          opener: args.opener,
          issuedAt: args.issuedAt as never,
          nonce: args.nonce,
          signature: 'fixture-sig' as never,
        };
      },
    };

    app = express();
    app.use(express.json());
    app.use('/workspace', fakeJwtMiddleware);
    registerAdminWriterRoutes(app, {
      elevatedAuthProvider: elevatedAuth,
      manifestWriter: {
        async readEntries() {
          return [];
        },
        async addEntry() {},
        async updateEntry() {},
        async removeEntry() {},
      },
      runLedgerWriter: ledger,
      infraRunIdNamespace: new InMemoryInfraRunIdNamespace(),
      adminMutationVerifier: passVerifier,
      adminMutationNonceStore: new InMemoryAdminMutationNonceStore(),
      adminMutationServerSigner: fixtureMutationSigner,
      signingCouncil: council,
      signingCouncilServerSigner: serverSigner,
    });

    const listening = await new Promise<{ server: Server; port: number }>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => {
        resolve({ server: s, port: (s.address() as AddressInfo).port });
      });
    });
    server = listening.server;
    baseUrl = `http://127.0.0.1:${listening.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
    process.chdir(originalCwd);
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  async function openEntity(
    admin: TestAdmin,
    entity: { entityId: string; displayName: string; entityType: string }
  ): Promise<{
    status: number;
    body: { ok: boolean; data?: SigningRequestSnapshot; error?: string };
  }> {
    const resp = await fetch(`${baseUrl}/workspace/admin/lexicon/entities`, {
      method: 'POST',
      headers: adminHeaders(admin),
      body: JSON.stringify(entity),
    });
    const body = (await resp.json()) as {
      ok: boolean;
      data?: SigningRequestSnapshot;
      error?: string;
    };
    return { status: resp.status, body };
  }

  async function signAsAdmin(
    requestId: string,
    admin: TestAdmin,
    options?: { precomputedSignature?: string }
  ): Promise<{
    status: number;
    body: { ok: boolean; data?: SigningRequestSnapshot; error?: string };
  }> {
    const url = `${baseUrl}/workspace/admin/signing/requests/${requestId}/signatures`;
    const body =
      options?.precomputedSignature !== undefined
        ? JSON.stringify({ signature: options.precomputedSignature })
        : JSON.stringify({});
    const resp = await fetch(url, {
      method: 'POST',
      headers: adminHeaders(admin),
      body,
    });
    const parsed = (await resp.json()) as {
      ok: boolean;
      data?: SigningRequestSnapshot;
      error?: string;
    };
    return { status: resp.status, body: parsed };
  }

  async function getRequest(requestId: string, admin: TestAdmin): Promise<SigningRequestSnapshot> {
    const resp = await fetch(`${baseUrl}/workspace/admin/signing/requests/${requestId}`, {
      method: 'GET',
      headers: adminHeaders(admin),
    });
    const parsed = (await resp.json()) as { ok: boolean; data: SigningRequestSnapshot };
    expect(parsed.ok).toBe(true);
    return parsed.data;
  }

  async function getEntities(admin: TestAdmin): Promise<ReadonlyArray<Record<string, unknown>>> {
    const resp = await fetch(`${baseUrl}/workspace/admin/lexicon/entities`, {
      method: 'GET',
      headers: adminHeaders(admin),
    });
    const parsed = (await resp.json()) as {
      ok: boolean;
      data: ReadonlyArray<Record<string, unknown>>;
    };
    expect(parsed.ok).toBe(true);
    return parsed.data;
  }

  // ── LEX-TWA-01 — open returns 202/pending/threshold=2 ───────────────────
  it('LEX-TWA-01: opens lexicon_mutation entity_add via HTTP → 202 pending requestId', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_01',
      displayName: 'lex_twa_01',
      entityType: 'ACTION_VERB',
    });
    expect(opened.status).toBe(202);
    expect(opened.body.ok).toBe(true);
    const data = opened.body.data!;
    expect(data.operation).toBe('lexicon_mutation');
    expect(data.status).toBe('pending');
    expect(data.signatures.length).toBe(0);
    expect(typeof data.requestId).toBe('string');
    expect(data.requestId.length).toBeGreaterThan(0);

    // No JSONL write yet
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    try {
      const raw = await fs.readFile(jsonlPath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.mutation?.entity?.entityId).not.toBe('verb_lex_twa_01');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  });

  // ── LEX-TWA-02 — first admin signature leaves request pending ───────────
  it('LEX-TWA-02: first admin signature leaves request pending; 1/2 signatures', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_02',
      displayName: 'lex_twa_02',
      entityType: 'ACTION_VERB',
    });
    const requestId = opened.body.data!.requestId;

    const signed = await signAsAdmin(requestId, adminA);
    expect(signed.status).toBe(200);
    expect(signed.body.ok).toBe(true);
    expect(signed.body.data!.status).toBe('pending');
    expect(signed.body.data!.signatures.length).toBe(1);
    expect(signed.body.data!.signatures[0]!.principalId).toBe(adminA.principalId);

    // Ledger received federated_operation_signature_added but not _executed
    const events = ledger.events.map(e => e.eventType);
    expect(events).toContain('federated_operation_signature_added');
    // _applied event not emitted until threshold met
    const appliedForThisRequest = ledger.events.some(
      e =>
        e.eventType === 'lexicon_mutation_applied' &&
        (e as unknown as { payload?: { requestId?: string } }).payload?.requestId === requestId
    );
    expect(appliedForThisRequest).toBe(false);
  });

  // ── LEX-TWA-03 — duplicate same-admin signature rejected ───────────────
  it('LEX-TWA-03: duplicate same-admin signature rejected with 409 DUPLICATE_SIGNER', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_03',
      displayName: 'lex_twa_03',
      entityType: 'ACTION_VERB',
    });
    const requestId = opened.body.data!.requestId;

    const firstSign = await signAsAdmin(requestId, adminA);
    expect(firstSign.status).toBe(200);
    expect(firstSign.body.data!.signatures.length).toBe(1);

    const dupSign = await signAsAdmin(requestId, adminA);
    expect(dupSign.status).toBe(409);
    expect(dupSign.body.ok).toBe(false);
    expect(String(dupSign.body.error)).toMatch(/DUPLICATE_SIGNER/);

    // Request remains pending with exactly 1 signature
    const afterDup = await getRequest(requestId, adminA);
    expect(afterDup.status).toBe('pending');
    expect(afterDup.signatures.length).toBe(1);
  });

  // ── LEX-TWA-04 — invalid signature bytes rejected ──────────────────────
  it('LEX-TWA-04: invalid pre-supplied signature bytes rejected with 403 INVALID_ADMIN_SIGNATURE', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_04',
      displayName: 'lex_twa_04',
      entityType: 'ACTION_VERB',
    });
    const requestId = opened.body.data!.requestId;

    // Pre-supply a valid-shape base64url signature with bogus bytes.
    // 64 bytes of zeros encoded as base64url ≈ 86 chars (no '=' padding).
    const bogusSig = b64uEncode(new Uint8Array(64));
    const invalidSign = await signAsAdmin(requestId, adminA, { precomputedSignature: bogusSig });
    expect(invalidSign.status).toBe(403);
    expect(invalidSign.body.ok).toBe(false);
    expect(String(invalidSign.body.error)).toMatch(/INVALID_ADMIN_SIGNATURE/);

    // Request remains pending with no signatures
    const afterInvalid = await getRequest(requestId, adminA);
    expect(afterInvalid.status).toBe('pending');
    expect(afterInvalid.signatures.length).toBe(0);
  });

  // ── LEX-TWA-05 — second distinct admin signature executes ──────────────
  it('LEX-TWA-05: second distinct admin signature dispatches mutation and emits ledger events', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_05',
      displayName: 'lex_twa_05',
      entityType: 'ACTION_VERB',
    });
    const requestId = opened.body.data!.requestId;

    await signAsAdmin(requestId, adminA);
    const eventCountBefore = ledger.events.length;
    const finalSign = await signAsAdmin(requestId, adminB);
    expect(finalSign.status).toBe(200);
    expect(finalSign.body.data!.status).toBe('executed');
    expect(finalSign.body.data!.signatures.length).toBe(2);
    const signerIds = finalSign.body.data!.signatures.map(s => s.principalId).sort();
    expect(signerIds).toEqual([adminA.principalId, adminB.principalId].sort());
    expect(typeof finalSign.body.data!.dispatchedAt).toBe('string');

    // JSONL has the appended line with both signers
    const jsonlPath = path.join(workRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    const raw = await fs.readFile(jsonlPath, 'utf-8');
    const matchingLines = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(o => o.mutation?.entity?.entityId === 'verb_lex_twa_05');
    expect(matchingLines.length).toBe(1);
    expect(matchingLines[0]!.signers).toContain(adminA.principalId);
    expect(matchingLines[0]!.signers).toContain(adminB.principalId);

    // Ledger emitted lexicon_mutation_applied + federated_operation_executed
    // for THIS request (the executor uses requestId in its payload).
    const newEvents = ledger.events.slice(eventCountBefore);
    const newEventTypes = newEvents.map(e => e.eventType);
    expect(newEventTypes).toContain('lexicon_mutation_applied');
    expect(newEventTypes).toContain('federated_operation_executed');
  });

  // ── LEX-TWA-06 — admin read surface sees applied state ─────────────────
  it('LEX-TWA-06: admin read surface (GET /workspace/admin/lexicon/entities) reflects the freshly-applied entity', async () => {
    const opened = await openEntity(adminA, {
      entityId: 'verb_lex_twa_06',
      displayName: 'lex_twa_06',
      entityType: 'ACTION_VERB',
    });
    const requestId = opened.body.data!.requestId;
    await signAsAdmin(requestId, adminA);
    const finalSign = await signAsAdmin(requestId, adminB);
    expect(finalSign.body.data!.status).toBe('executed');

    const entities = await getEntities(adminA);
    // GET returns the raw lexicon_entity.jsonl lines (one per mutation).
    // The latest applied mutation for verb_lex_twa_06 must be present.
    const matching = entities.filter(
      e =>
        (e as { mutation?: { entity?: { entityId?: string } } }).mutation?.entity?.entityId ===
        'verb_lex_twa_06'
    );
    expect(matching.length).toBe(1);
  });
});
