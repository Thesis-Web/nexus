/**
 * Unit tests for the three SigningCouncil dispatchers.
 *
 * The dispatchers all assume the council has already validated the
 * SigningRequest (2 distinct signatures, signatures verified, request not
 * expired). These tests exercise the apply step only.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import type {
  Base64Url,
  IsoTimestamp,
  LexiconMutation,
  ModeConfiguration,
  NonEmpty,
  RunEventType,
  RunLedgerWriter,
  SigningRequest,
} from '@nexus/contracts';
import type { KeyPair } from '../crypto/key-manager.js';
import { base64urlEncode } from '../crypto/signer.js';
import { JsonlLexiconMutationExecutor } from '../lexicon/lexicon-mutation-executor.js';
import {
  buildLexiconMutationDispatcher,
  buildModeUnlockDispatcher,
  buildSigningCouncilChangeDispatcher,
} from './signing-council-dispatchers.js';

async function makeTestKeypair(): Promise<KeyPair> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  return {
    publicKey: base64urlEncode(pub) as Base64Url,
    privateKey: base64urlEncode(priv) as Base64Url,
    generatedAt: new Date().toISOString() as IsoTimestamp,
    purpose: 'dev',
  };
}

function makeLedger(): RunLedgerWriter & {
  events: Array<{ eventType: RunEventType; detail: Record<string, unknown> }>;
} {
  const events: Array<{ eventType: RunEventType; detail: Record<string, unknown> }> = [];
  return {
    events,
    async writeEvent(ev) {
      events.push({ eventType: ev.eventType as RunEventType, detail: ev.detail });
    },
  } as never;
}

function makeRequest(overrides: Partial<SigningRequest> = {}): SigningRequest {
  return {
    requestId: 'req-1' as NonEmpty,
    operation: 'lexicon_mutation',
    payload: {},
    payloadDigest: 'deadbeef' as never,
    openedAt: '2026-05-20T00:00:00.000Z' as IsoTimestamp,
    openedBy: 'admin-a' as NonEmpty,
    expiresAt: '2026-05-21T00:00:00.000Z' as IsoTimestamp,
    signatures: [
      {
        principalId: 'admin-a' as NonEmpty,
        signature: 'sig-a' as Base64Url,
        signedAt: '2026-05-20T00:01:00.000Z' as IsoTimestamp,
      },
      {
        principalId: 'admin-b' as NonEmpty,
        signature: 'sig-b' as Base64Url,
        signedAt: '2026-05-20T00:02:00.000Z' as IsoTimestamp,
      },
    ],
    status: 'pending',
    ...overrides,
  };
}

describe('buildLexiconMutationDispatcher (F4.8 §3.3)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lex-dispatcher-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('invokes executor.apply with the typed mutation + signers', async () => {
    const ledger = makeLedger();
    const executor = new JsonlLexiconMutationExecutor({
      runLedger: ledger,
      fixturesRoot: tmpRoot,
    });
    const dispatcher = buildLexiconMutationDispatcher(executor);
    const mutation: LexiconMutation = {
      kind: 'entity_add',
      entity: {
        entityId: 'verb_pull' as NonEmpty,
        displayName: 'pull' as NonEmpty,
        entityType: 'ACTION_VERB' as NonEmpty,
      },
    };
    await dispatcher(makeRequest({ payload: { mutation } }));
    expect(ledger.events.map(e => e.eventType)).toContain('lexicon_mutation_applied');
    const lines = (
      await fs.readFile(path.join(tmpRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl'), 'utf-8')
    )
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).mutation.kind).toBe('entity_add');
  });

  it('throws LEXICON_DISPATCH_BAD_PAYLOAD when payload has no mutation', async () => {
    const dispatcher = buildLexiconMutationDispatcher(
      new JsonlLexiconMutationExecutor({ runLedger: makeLedger(), fixturesRoot: tmpRoot })
    );
    await expect(dispatcher(makeRequest({ payload: {} }))).rejects.toThrow(
      /LEXICON_DISPATCH_BAD_PAYLOAD/
    );
  });

  it('throws LEXICON_DISPATCH_UNKNOWN_KIND on unknown kind', async () => {
    const dispatcher = buildLexiconMutationDispatcher(
      new JsonlLexiconMutationExecutor({ runLedger: makeLedger(), fixturesRoot: tmpRoot })
    );
    const bad = { kind: 'rogue_kind', entity: {} } as unknown as LexiconMutation;
    await expect(dispatcher(makeRequest({ payload: { mutation: bad } }))).rejects.toThrow(
      /LEXICON_DISPATCH_UNKNOWN_KIND: rogue_kind/
    );
  });
});

describe('buildModeUnlockDispatcher (F4.17 + F4.1)', () => {
  let kp: KeyPair;

  beforeEach(async () => {
    kp = await makeTestKeypair();
  });

  function baseConfig(): ModeConfiguration {
    return {
      nxsMode: 'enforcing',
      nvgMode: 'enforcing',
      enforcingLocked: true,
      updatedAt: '2026-05-20T00:00:00.000Z' as IsoTimestamp,
      updatedBy: { adminId: 'admin-a' as NonEmpty, publicKey: 'PUB' as Base64Url },
      signature: 'PRIOR_SIG' as Base64Url,
    };
  }

  it('applies enforcingLocked=false, emits enforcing_lock_disabled, saves new config', async () => {
    const ledger = makeLedger();
    let savedConfig: ModeConfiguration | null = null;
    const dispatcher = buildModeUnlockDispatcher({
      loadModeConfig: async () => baseConfig(),
      saveModeConfig: async next => {
        savedConfig = next;
      },
      loadAdminKeypair: async () => kp,
      runLedger: ledger,
    });
    await dispatcher(makeRequest({ operation: 'mode_unlock' }));
    expect(savedConfig).not.toBeNull();
    expect(savedConfig!.enforcingLocked).toBe(false);
    expect(savedConfig!.signature).not.toBe('PRIOR_SIG');
    expect(ledger.events.map(e => e.eventType)).toContain('enforcing_lock_disabled');
  });

  it('throws when the opener has no admin keypair on disk', async () => {
    const dispatcher = buildModeUnlockDispatcher({
      loadModeConfig: async () => baseConfig(),
      saveModeConfig: async () => {},
      loadAdminKeypair: async () => null,
      runLedger: makeLedger(),
    });
    await expect(dispatcher(makeRequest({ operation: 'mode_unlock' }))).rejects.toThrow(
      /MODE_UNLOCK_DISPATCH_NO_OPENER_KEYPAIR/
    );
  });

  it('throws when enforcingLocked is already false', async () => {
    const dispatcher = buildModeUnlockDispatcher({
      loadModeConfig: async () => ({ ...baseConfig(), enforcingLocked: false }),
      saveModeConfig: async () => {},
      loadAdminKeypair: async () => kp,
      runLedger: makeLedger(),
    });
    await expect(dispatcher(makeRequest({ operation: 'mode_unlock' }))).rejects.toThrow(
      /MODE_UNLOCK_DISPATCH_NOT_LOCKED/
    );
  });
});

describe('buildSigningCouncilChangeDispatcher (F4.1 admin signing key federation)', () => {
  let keyDir: string;

  beforeEach(async () => {
    keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scc-keys-'));
    await fs.mkdir(path.join(keyDir, 'admins'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(keyDir, { recursive: true, force: true });
  });

  it('add_admin_key writes the public key file at 0600', async () => {
    const dispatcher = buildSigningCouncilChangeDispatcher({ keyDirectory: keyDir });
    await dispatcher(
      makeRequest({
        operation: 'signing_council_change',
        payload: {
          action: 'add_admin_key',
          principalId: 'admin-c',
          publicKey: 'PUBC',
        },
      })
    );
    const target = path.join(keyDir, 'admins', 'admin-c.public.json');
    const stat = await fs.stat(target);
    expect((stat.mode & 0o777).toString(8)).toBe('600');
    const raw = JSON.parse(await fs.readFile(target, 'utf-8'));
    expect(raw.principalId).toBe('admin-c');
    expect(raw.publicKey).toBe('PUBC');
  });

  it('add_admin_key forbids changing a key in place (rotation must dereg first)', async () => {
    const dispatcher = buildSigningCouncilChangeDispatcher({ keyDirectory: keyDir });
    await fs.writeFile(
      path.join(keyDir, 'admins', 'admin-c.public.json'),
      JSON.stringify({ principalId: 'admin-c', publicKey: 'OLD_KEY' })
    );
    await expect(
      dispatcher(
        makeRequest({
          operation: 'signing_council_change',
          payload: {
            action: 'add_admin_key',
            principalId: 'admin-c',
            publicKey: 'NEW_KEY',
          },
        })
      )
    ).rejects.toThrow(/SIGNING_COUNCIL_CHANGE_KEY_ROTATION_FORBIDDEN/);
  });

  it('remove_admin_key deletes the public key file', async () => {
    const dispatcher = buildSigningCouncilChangeDispatcher({ keyDirectory: keyDir });
    const target = path.join(keyDir, 'admins', 'admin-c.public.json');
    await fs.writeFile(target, JSON.stringify({ principalId: 'admin-c', publicKey: 'PUBC' }));
    await dispatcher(
      makeRequest({
        operation: 'signing_council_change',
        payload: {
          action: 'remove_admin_key',
          principalId: 'admin-c',
        },
      })
    );
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it('remove_admin_key throws when principal has no registered key', async () => {
    const dispatcher = buildSigningCouncilChangeDispatcher({ keyDirectory: keyDir });
    await expect(
      dispatcher(
        makeRequest({
          operation: 'signing_council_change',
          payload: {
            action: 'remove_admin_key',
            principalId: 'admin-unknown',
          },
        })
      )
    ).rejects.toThrow(/SIGNING_COUNCIL_CHANGE_UNKNOWN_PRINCIPAL/);
  });

  it('rejects malformed payload', async () => {
    const dispatcher = buildSigningCouncilChangeDispatcher({ keyDirectory: keyDir });
    await expect(
      dispatcher(makeRequest({ operation: 'signing_council_change', payload: {} }))
    ).rejects.toThrow(/SIGNING_COUNCIL_CHANGE_BAD_PAYLOAD/);
  });
});
