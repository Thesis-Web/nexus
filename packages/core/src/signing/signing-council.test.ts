/**
 * Unit tests for the SigningCouncil — F4.1 FED-01 through FED-09.
 *
 * These tests exercise the council against a fixture pair of admin
 * keys (writes private keys to a tmp dir + sets NEXUS_KEY_PATH-style
 * paths via the loadAdminPublicKey helper). The ledger writer is a
 * Map-backed mock; the request store defaults to in-memory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Buffer } from 'node:buffer';
import {
  FEDERATED_OPERATION,
  SIGNING_REQUEST_STATUS,
  getThreshold,
  type Base64Url,
  type NonEmpty,
  type RunLedgerWriter,
  type RunLedgerEntry,
  type FederatedOperationName,
} from '@nexus/contracts';
import {
  SigningCouncil,
  InMemorySigningCouncilRequestStore,
  type SigningCouncilDeps,
} from './signing-council.js';

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
  const principalId = `admin-${slug}-${randomUUID().slice(0, 8)}` as NonEmpty;
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

describe('SigningCouncil (F4.1)', () => {
  let originalCwd: string;
  let keysRoot: string;
  let adminA: TestAdmin;
  let adminB: TestAdmin;

  beforeAll(async () => {
    // loadAdminPublicKey reads from cwd/keys/admins/<adminId>.public.json,
    // so we chdir into a tmp dir for the duration of these tests.
    originalCwd = process.cwd();
    keysRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'signing-council-keys-'));
    process.chdir(keysRoot);
    adminA = await generateAdmin('keys', 'a');
    adminB = await generateAdmin('keys', 'b');
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.rm(keysRoot, { recursive: true, force: true });
  });

  function makeDeps(dispatchers: SigningCouncilDeps['dispatchers'] = {}): {
    deps: SigningCouncilDeps;
    ledger: MockRunLedger;
  } {
    const ledger = new MockRunLedger();
    return {
      ledger,
      deps: {
        store: new InMemorySigningCouncilRequestStore(),
        runLedger: ledger,
        dispatchers,
      },
    };
  }

  it('FED-01: getThreshold returns 2 for every V1 operation', () => {
    expect(getThreshold(FEDERATED_OPERATION.MODE_UNLOCK)).toBe(2);
    expect(getThreshold(FEDERATED_OPERATION.POLICY_BUNDLE_REPLACE)).toBe(2);
    expect(getThreshold(FEDERATED_OPERATION.SIGNING_COUNCIL_CHANGE)).toBe(2);
    expect(getThreshold(FEDERATED_OPERATION.LEXICON_MUTATION)).toBe(2);
  });

  it('FED-02: open + single signature stays pending, dispatcher not called', async () => {
    let called = 0;
    const { deps } = makeDeps({
      mode_unlock: async () => {
        called += 1;
      },
    });
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'test' },
      openedBy: adminA.principalId,
    });
    expect(opened.status).toBe(SIGNING_REQUEST_STATUS.PENDING);
    const sigA = await signEnvelope(council.canonicalSigningEnvelope(opened), adminA.privateKey);
    const afterSign = await council.sign(opened.requestId, adminA.principalId, sigA);
    expect(afterSign.status).toBe(SIGNING_REQUEST_STATUS.PENDING);
    expect(afterSign.signatures).toHaveLength(1);
    expect(called).toBe(0);
  });

  it('FED-03: 2 distinct signatures → executed, dispatcher called once', async () => {
    let calls: FederatedOperationName[] = [];
    const { deps, ledger } = makeDeps({
      mode_unlock: async req => {
        calls.push(req.operation);
      },
    });
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'test' },
      openedBy: adminA.principalId,
    });
    const envelope = council.canonicalSigningEnvelope(opened);
    const sigA = await signEnvelope(envelope, adminA.privateKey);
    const sigB = await signEnvelope(envelope, adminB.privateKey);
    await council.sign(opened.requestId, adminA.principalId, sigA);
    const final = await council.sign(opened.requestId, adminB.principalId, sigB);
    expect(final.status).toBe(SIGNING_REQUEST_STATUS.EXECUTED);
    expect(calls).toEqual(['mode_unlock']);
    expect(ledger.events.map(e => e.eventType)).toContain('federated_operation_executed');
  });

  it('FED-04: duplicate signer from same principal → 409', async () => {
    const { deps } = makeDeps({ mode_unlock: async () => {} });
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'test' },
      openedBy: adminA.principalId,
    });
    const sigA = await signEnvelope(council.canonicalSigningEnvelope(opened), adminA.privateKey);
    await council.sign(opened.requestId, adminA.principalId, sigA);
    await expect(council.sign(opened.requestId, adminA.principalId, sigA)).rejects.toThrow(
      'DUPLICATE_SIGNER'
    );
  });

  it('FED-05: signature from unregistered admin → rejected', async () => {
    const { deps } = makeDeps({ mode_unlock: async () => {} });
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'test' },
      openedBy: adminA.principalId,
    });
    const sig = await signEnvelope(council.canonicalSigningEnvelope(opened), adminA.privateKey);
    await expect(council.sign(opened.requestId, 'admin-unknown' as NonEmpty, sig)).rejects.toThrow(
      'UNKNOWN_ADMIN'
    );
  });

  it('FED-07: signature for one request cannot be replayed on another', async () => {
    const { deps } = makeDeps({ mode_unlock: async () => {} });
    const council = new SigningCouncil(deps);
    const req1 = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'first' },
      openedBy: adminA.principalId,
    });
    const req2 = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'second' },
      openedBy: adminA.principalId,
    });
    const sigForReq1 = await signEnvelope(
      council.canonicalSigningEnvelope(req1),
      adminA.privateKey
    );
    // Replaying sigForReq1 on req2 must fail because envelope includes requestId.
    await expect(council.sign(req2.requestId, adminA.principalId, sigForReq1)).rejects.toThrow(
      'INVALID_ADMIN_SIGNATURE'
    );
  });

  it('FED-08: lexicon_mutation operation open succeeds (dispatcher lands in Patch 8)', async () => {
    const { deps } = makeDeps({}); // no dispatcher → request goes to denied on threshold
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'lexicon_mutation',
      payload: { kind: 'entity_create', entityId: 'demo' },
      openedBy: adminA.principalId,
    });
    expect(opened.operation).toBe('lexicon_mutation');
    expect(opened.status).toBe(SIGNING_REQUEST_STATUS.PENDING);
  });

  it('FED-09: dispatcher throws → request marked denied', async () => {
    const { deps, ledger } = makeDeps({
      mode_unlock: async () => {
        throw new Error('dispatcher_simulated_fail');
      },
    });
    const council = new SigningCouncil(deps);
    const opened = await council.open({
      operation: 'mode_unlock',
      payload: { reason: 'fails' },
      openedBy: adminA.principalId,
    });
    const envelope = council.canonicalSigningEnvelope(opened);
    const sigA = await signEnvelope(envelope, adminA.privateKey);
    const sigB = await signEnvelope(envelope, adminB.privateKey);
    await council.sign(opened.requestId, adminA.principalId, sigA);
    const final = await council.sign(opened.requestId, adminB.principalId, sigB);
    expect(final.status).toBe(SIGNING_REQUEST_STATUS.DENIED);
    expect(final.denialReason).toMatch(/dispatcher_simulated_fail/);
    expect(ledger.events.map(e => e.eventType)).toContain('federated_operation_dispatch_failed');
  });
});
