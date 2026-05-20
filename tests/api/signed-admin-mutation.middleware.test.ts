/**
 * SignedAdminMutation middleware — unit tests (F4.13).
 *
 * Fast-feedback coverage of `withAdminMutation()` and
 * `InMemoryAdminMutationNonceStore`. Exercises every branch of the
 * wrapper without spinning up Express: req/res are minimal stand-ins that
 * capture the .status() + .json() calls.
 *
 * The integration suite `admin-mutation-envelope.integration.test.ts`
 * covers the SAM-01..SAM-11 scenarios at the HTTP boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type {
  AdminMutationKind,
  ElevatedAuthProvider,
  InfraRunIdNamespace,
  ModeConfiguration,
  NonEmpty,
  RunLedgerEntry,
  RunLedgerWriter,
  SignedAdminMutation,
  Uuid,
} from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import {
  withAdminMutation,
  InMemoryAdminMutationNonceStore,
  type AdminMutationVerifierPort,
  type AdminMutationNonceStorePort,
  type AdminMutationServerSignerPort,
} from '../../packages/interfaces/api/src/middleware/signed-admin-mutation.js';

interface FakeRes {
  statusCode?: number;
  body?: unknown;
}

function fakeRes(localsClaims: { claims: unknown; actorId: string; principalId: string }): {
  res: Response;
  captured: FakeRes;
} {
  const captured: FakeRes = {};
  const res: Partial<Response> = {
    locals: localsClaims,
    status(code: number) {
      captured.statusCode = code;
      return this as Response;
    },
    json(body: unknown) {
      captured.body = body;
      return this as Response;
    },
  };
  return { res: res as Response, captured };
}

function fakeReq(body: unknown, elevatedSession = 'sess-1'): Request {
  return {
    body,
    headers: { 'x-elevated-session': elevatedSession },
  } as unknown as Request;
}

const PRINCIPAL_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

function makeAuthDeps(): {
  elevatedAuthProvider: ElevatedAuthProvider;
} {
  return {
    elevatedAuthProvider: {
      async validateSession(): Promise<{ valid: true; principalId: NonEmpty }> {
        return { valid: true, principalId: PRINCIPAL_ID as NonEmpty };
      },
      async issueSession(): Promise<{ sessionId: Uuid; principalId: NonEmpty; expiresAt: string }> {
        throw new Error('unused');
      },
      async revokeSession(): Promise<void> {
        // unused in these tests
      },
    } as unknown as ElevatedAuthProvider,
  };
}

function makeAdminClaims(): { claims: unknown; actorId: string; principalId: string } {
  return {
    claims: {
      roleAssignments: ['nexus-admin'],
    },
    actorId: ACTOR_ID,
    principalId: PRINCIPAL_ID,
  };
}

function captureWriter(): {
  writer: RunLedgerWriter;
  entries: RunLedgerEntry[];
} {
  const entries: RunLedgerEntry[] = [];
  const writer: RunLedgerWriter = {
    async writeEvent(entry): Promise<void> {
      entries.push({
        entryId: ('e-' + entries.length.toString()) as Uuid,
        ...entry,
      });
    },
    async getByRunId(): Promise<RunLedgerEntry[]> {
      return entries;
    },
    async tail(): Promise<RunLedgerEntry[]> {
      return entries.slice(-10);
    },
    async getLatestRunId(): Promise<Uuid | null> {
      return null;
    },
  };
  return { writer, entries };
}

class StaticInfraNs implements InfraRunIdNamespace {
  private seq = 0;
  next(): NonEmpty {
    this.seq += 1;
    return `infra-2026-05-20-${this.seq.toString().padStart(4, '0')}` as NonEmpty;
  }
}

function makeVerifier(ok: boolean, reason?: string): AdminMutationVerifierPort {
  return {
    async verify(envelope: SignedAdminMutation<unknown>): Promise<
      | {
          ok: true;
          opener: NonEmpty;
          payloadDigest: string;
          signatureRef: string;
        }
      | { ok: false; reason: 'invalid_signature' | 'opener_unknown' | 'malformed_envelope' }
    > {
      if (!ok) {
        return {
          ok: false,
          reason: (reason as 'invalid_signature') ?? 'invalid_signature',
        };
      }
      return {
        ok: true,
        opener: envelope.opener as NonEmpty,
        payloadDigest: 'digest-fixture',
        signatureRef: 'sigref-fixture',
      };
    },
  };
}

function makeSigner(opener = PRINCIPAL_ID): AdminMutationServerSignerPort {
  return {
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
        opener: opener as NonEmpty,
        issuedAt: args.issuedAt as never,
        nonce: args.nonce,
        signature: 'sig-fixture' as never,
      };
    },
  };
}

function makeNonceStore(): AdminMutationNonceStorePort {
  return new InMemoryAdminMutationNonceStore(() => 1700000000000);
}

function makeModeLoader(
  mode: 'observe' | 'advisory' | 'enforcing'
): () => Promise<ModeConfiguration> {
  return async (): Promise<ModeConfiguration> => ({
    nxsMode: mode,
    nvgMode: mode,
    enforcingLocked: false,
    updatedAt: '2026-05-20T00:00:00.000Z' as never,
    updatedBy: { adminId: 'admin' as NonEmpty, publicKey: 'pk' as never },
    signature: 'sig' as never,
  });
}

const VALID_PAYLOAD = { endpointId: 'ep-1' };

const VALID_ENVELOPE: SignedAdminMutation<{ endpointId: string }> = {
  mutationKind: 'manifest_entry_add',
  payload: VALID_PAYLOAD,
  opener: PRINCIPAL_ID as NonEmpty,
  issuedAt: '2026-05-20T00:00:00.000Z' as never,
  nonce: 'nonce-fixture-1' as NonEmpty,
  signature: 'sig-fixture' as never,
};

describe('withAdminMutation — happy path', () => {
  let entries: RunLedgerEntry[];
  let writer: RunLedgerWriter;
  beforeEach(() => {
    ({ entries, writer } = captureWriter());
  });

  it('writes intent + committed + returns 200 with mutationId', async () => {
    const handlerCalled = vi.fn();
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('enforcing'),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async payload => {
          handlerCalled(payload);
          return { kind: 'ok', result: { endpointId: payload.endpointId } };
        },
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(handlerCalled).toHaveBeenCalledWith(VALID_PAYLOAD);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { ok: boolean; data: { mutationId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.mutationId).toMatch(/^infra-2026-05-20-/);
    const types = entries.map(e => e.eventType);
    expect(types).toEqual(['admin_mutation_intent', 'admin_mutation_committed']);
    expect(entries[0]!.detail['wouldCommit']).toBe(false);
  });
});

describe('withAdminMutation — error branches', () => {
  it('SAM-01: returns 400 when body is missing required envelope fields', async () => {
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: captureWriter().writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        // No server signer wired — plain payload path will 503.
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: () => ({ ok: false, status: 400, error: 'invalid' }),
        handler: async () => ({ kind: 'ok', result: {} }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq({ notAnEnvelope: true }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('SAM-02: returns 403 on invalid signature', async () => {
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: captureWriter().writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(false, 'invalid_signature'),
        adminMutationNonceStore: makeNonceStore(),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: {} }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(403);
    expect((captured.body as { denialCode: string }).denialCode).toBe(
      DENIAL_CODE.ADMIN_MUTATION_SIGNATURE_INVALID
    );
  });

  it('SAM-03: returns 409 on replayed nonce', async () => {
    const nonceStore = makeNonceStore();
    const baseDeps = {
      ...makeAuthDeps(),
      runLedgerWriter: captureWriter().writer,
      infraRunIdNamespace: new StaticInfraNs(),
      adminMutationVerifier: makeVerifier(true),
      adminMutationNonceStore: nonceStore,
      loadModeConfig: makeModeLoader('enforcing'),
    };
    const handler = withAdminMutation(baseDeps, {
      mutationKind: 'manifest_entry_add',
      parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
      handler: async () => ({ kind: 'ok', result: {} }),
    });
    const first = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), first.res);
    expect(first.captured.statusCode).toBe(200);
    // Replay the same envelope (same nonce).
    const second = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), second.res);
    expect(second.captured.statusCode).toBe(409);
    expect((second.captured.body as { denialCode: string }).denialCode).toBe(
      DENIAL_CODE.ADMIN_MUTATION_NONCE_REPLAY
    );
  });

  it('SAM-04: returns 503 when runLedgerWriter is unavailable', async () => {
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        // runLedgerWriter intentionally omitted.
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: {} }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(503);
    expect((captured.body as { denialCode: string }).denialCode).toBe(
      DENIAL_CODE.AUDIT_UNAVAILABLE
    );
  });

  it('returns 503 + AUDIT_UNAVAILABLE when intent write throws', async () => {
    const throwingWriter: RunLedgerWriter = {
      async writeEvent(): Promise<void> {
        throw new Error('ledger backend down');
      },
      async getByRunId(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async tail(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async getLatestRunId(): Promise<Uuid | null> {
        return null;
      },
    };
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: throwingWriter,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: {} }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(503);
    expect((captured.body as { denialCode: string }).denialCode).toBe(
      DENIAL_CODE.AUDIT_UNAVAILABLE
    );
  });
});

describe('withAdminMutation — observe mode', () => {
  it('SAM-10: observe mode logs intent with wouldCommit=true and SKIPS mutation', async () => {
    const { writer, entries } = captureWriter();
    const handlerCalled = vi.fn();
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('observe'),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => {
          handlerCalled();
          return { kind: 'ok', result: {} };
        },
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(handlerCalled).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(202);
    expect((captured.body as { observeOnly: boolean }).observeOnly).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.eventType).toBe('admin_mutation_intent');
    expect(entries[0]!.detail['wouldCommit']).toBe(true);
  });
});

describe('withAdminMutation — committed_but_audit_failed', () => {
  it('SAM-07: post-commit ledger write fails (non-transactional) → 207 with state', async () => {
    let calls = 0;
    const writer: RunLedgerWriter = {
      async writeEvent(): Promise<void> {
        calls += 1;
        // Intent write succeeds; committed write fails.
        if (calls === 2) throw new Error('ledger backend dropped');
      },
      async getByRunId(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async tail(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async getLatestRunId(): Promise<Uuid | null> {
        return null;
      },
    };
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('enforcing'),
        runLedgerSupportsTransactionalRollback: false,
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: { applied: true } }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(207);
    expect((captured.body as { state: string }).state).toBe('committed_but_audit_failed');
  });

  it('SAM-06: post-commit ledger write fails (transactional) → rollback + 500', async () => {
    let calls = 0;
    const writer: RunLedgerWriter = {
      async writeEvent(): Promise<void> {
        calls += 1;
        if (calls === 2) throw new Error('ledger backend dropped');
      },
      async getByRunId(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async tail(): Promise<RunLedgerEntry[]> {
        return [];
      },
      async getLatestRunId(): Promise<Uuid | null> {
        return null;
      },
    };
    const rollback = vi.fn(async () => {
      // rollback succeeds
    });
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('enforcing'),
        runLedgerSupportsTransactionalRollback: true,
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: { applied: true }, onRollback: rollback }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(rollback).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(500);
  });
});

describe('withAdminMutation — plain-payload UI path', () => {
  it('forges envelope via server signer when body is a plain payload', async () => {
    const { writer, entries } = captureWriter();
    const signer = makeSigner();
    const signSpy = vi.spyOn(signer, 'sign');
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        adminMutationServerSigner: signer,
        loadModeConfig: makeModeLoader('enforcing'),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => {
          const b = body as { endpointId?: string };
          if (typeof b.endpointId !== 'string') return { ok: false, status: 400, error: 'bad' };
          return { ok: true, data: { endpointId: b.endpointId } };
        },
        handler: async payload => ({ kind: 'ok', result: { endpointId: payload.endpointId } }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq({ endpointId: 'ep-1' }), res);
    expect(signSpy).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(200);
    expect(entries.map(e => e.eventType)).toEqual([
      'admin_mutation_intent',
      'admin_mutation_committed',
    ]);
  });

  it('returns 412 when server signer rejects (admin keypair missing)', async () => {
    const failingSigner: AdminMutationServerSignerPort = {
      async sign(): Promise<never> {
        throw Object.assign(new Error('admin keypair missing'), { statusCode: 412 });
      },
    };
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: captureWriter().writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        adminMutationServerSigner: failingSigner,
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'ok', result: {} }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq({ endpointId: 'ep-1' }), res);
    expect(captured.statusCode).toBe(412);
  });
});

describe('withAdminMutation — handler failure', () => {
  it('writes admin_mutation_failed when handler returns kind:"failed"', async () => {
    const { writer, entries } = captureWriter();
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('enforcing'),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => ({ kind: 'failed', reason: 'manifest write failed', statusCode: 500 }),
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(500);
    expect(entries.map(e => e.eventType)).toEqual([
      'admin_mutation_intent',
      'admin_mutation_failed',
    ]);
  });

  it('writes admin_mutation_failed when handler throws', async () => {
    const { writer, entries } = captureWriter();
    const handler = withAdminMutation(
      {
        ...makeAuthDeps(),
        runLedgerWriter: writer,
        infraRunIdNamespace: new StaticInfraNs(),
        adminMutationVerifier: makeVerifier(true),
        adminMutationNonceStore: makeNonceStore(),
        loadModeConfig: makeModeLoader('enforcing'),
      },
      {
        mutationKind: 'manifest_entry_add',
        parsePayload: body => ({ ok: true, data: body as { endpointId: string } }),
        handler: async () => {
          throw Object.assign(new Error('upstream broke'), { statusCode: 502 });
        },
      }
    );
    const { res, captured } = fakeRes(makeAdminClaims());
    await handler(fakeReq(VALID_ENVELOPE), res);
    expect(captured.statusCode).toBe(502);
    expect(entries.map(e => e.eventType)).toEqual([
      'admin_mutation_intent',
      'admin_mutation_failed',
    ]);
  });
});

describe('InMemoryAdminMutationNonceStore', () => {
  it('claims a fresh nonce, rejects replay within TTL', async () => {
    const store = new InMemoryAdminMutationNonceStore(() => 1700000000000);
    expect(await store.claim('n1' as NonEmpty, 60)).toBe(true);
    expect(await store.claim('n1' as NonEmpty, 60)).toBe(false);
  });

  it('accepts the nonce again once the TTL window has elapsed', async () => {
    let now = 1700000000000;
    const store = new InMemoryAdminMutationNonceStore(() => now);
    expect(await store.claim('n1' as NonEmpty, 60)).toBe(true);
    now += 61_000;
    expect(await store.claim('n1' as NonEmpty, 60)).toBe(true);
  });
});
