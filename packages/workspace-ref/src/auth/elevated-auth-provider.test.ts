/**
 * Tests for ReferenceElevatedAuthProvider — production-correct
 * credential verification (no "any non-empty response accepted"
 * fallback; GOV-AUTHORITY-STRICTNESS-GATE).
 *
 * Coverage:
 *   - constructor refuses to build without a verifier
 *   - verify() rejects when the verifier returns false
 *   - verify() rejects when the verifier throws
 *   - verify() succeeds with a matching credential and issues a session
 *   - verify() rejects empty responses without invoking the verifier
 *   - validateSession is principal-bound (hard rule 30)
 *   - validateSession refuses an issued session if the wrong principal
 *     presents it (defence-in-depth)
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ElevatedAuthMethod,
  ElevatedCredentialVerifier,
  IsoTimestamp,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { ReferenceElevatedAuthProvider } from './elevated-auth-provider.js';

interface VerifierCall {
  principalId: string;
  method: ElevatedAuthMethod;
  response: string;
}

function makeVerifier(returnVal: boolean | Error): {
  verifier: ElevatedCredentialVerifier;
  calls: VerifierCall[];
} {
  const calls: VerifierCall[] = [];
  return {
    calls,
    verifier: {
      async verify(input): Promise<boolean> {
        calls.push({
          principalId: input.principalId,
          method: input.method,
          response: input.response,
        });
        if (returnVal instanceof Error) throw returnVal;
        return returnVal;
      },
    },
  };
}

async function tmpDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eap-test-'));
  return path.join(dir, 'workspace-ref.sqlite');
}

const PRINCIPAL = '00000000-0000-4000-a000-000000000001';

describe('ReferenceElevatedAuthProvider — credential verifier wiring', () => {
  it('constructor throws if credentialVerifier is missing', () => {
    expect(() => new ReferenceElevatedAuthProvider(undefined as unknown as never)).toThrow(
      /requires opts.credentialVerifier/
    );
    expect(
      () =>
        new ReferenceElevatedAuthProvider({
          credentialVerifier: undefined as unknown as ElevatedCredentialVerifier,
          dbPath: ':memory:',
        })
    ).toThrow(/requires opts.credentialVerifier/);
    expect(
      () =>
        new ReferenceElevatedAuthProvider({
          credentialVerifier: {} as ElevatedCredentialVerifier,
          dbPath: ':memory:',
        })
    ).toThrow(/requires opts.credentialVerifier/);
  });

  it('verify() rejects when the verifier returns false (invalid credential)', async () => {
    const { verifier, calls } = makeVerifier(false);
    const provider = new ReferenceElevatedAuthProvider({
      credentialVerifier: verifier,
      dbPath: await tmpDbPath(),
    });
    const c = await provider.challenge({ principalId: PRINCIPAL, method: 'api_key_reauth' });
    await expect(
      provider.verify({
        challengeId: c.challengeId as Uuid,
        principalId: PRINCIPAL,
        method: 'api_key_reauth',
        response: 'wrong-key',
      })
    ).rejects.toThrow(/Invalid credential/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.response).toBe('wrong-key');
  });

  it('verify() rejects when the verifier throws (fail closed)', async () => {
    const { verifier } = makeVerifier(new Error('identity provider unreachable'));
    const provider = new ReferenceElevatedAuthProvider({
      credentialVerifier: verifier,
      dbPath: await tmpDbPath(),
    });
    const c = await provider.challenge({ principalId: PRINCIPAL, method: 'api_key_reauth' });
    await expect(
      provider.verify({
        challengeId: c.challengeId as Uuid,
        principalId: PRINCIPAL,
        method: 'api_key_reauth',
        response: 'any',
      })
    ).rejects.toThrow();
  });

  it('verify() rejects empty response BEFORE calling the verifier', async () => {
    const { verifier, calls } = makeVerifier(true);
    const provider = new ReferenceElevatedAuthProvider({
      credentialVerifier: verifier,
      dbPath: await tmpDbPath(),
    });
    const c = await provider.challenge({ principalId: PRINCIPAL, method: 'api_key_reauth' });
    await expect(
      provider.verify({
        challengeId: c.challengeId as Uuid,
        principalId: PRINCIPAL,
        method: 'api_key_reauth',
        response: '',
      })
    ).rejects.toThrow(/Empty response/);
    expect(calls).toHaveLength(0); // verifier never invoked for empty input
  });

  it('verify() with matching credential issues a session and validates principal-bound', async () => {
    const { verifier, calls } = makeVerifier(true);
    const provider = new ReferenceElevatedAuthProvider({
      credentialVerifier: verifier,
      dbPath: await tmpDbPath(),
    });
    const c = await provider.challenge({ principalId: PRINCIPAL, method: 'api_key_reauth' });
    const session = await provider.verify({
      challengeId: c.challengeId as Uuid,
      principalId: PRINCIPAL,
      method: 'api_key_reauth',
      response: 'correct-key',
    });
    expect(session.principalId).toBe(PRINCIPAL);
    expect(session.method).toBe('api_key_reauth');
    expect(typeof session.elevatedSessionId).toBe('string');
    expect(calls[0]!.response).toBe('correct-key');
    expect(calls[0]!.principalId).toBe(PRINCIPAL);

    // validateSession with the matching principal succeeds…
    const ok = await provider.validateSession(session.elevatedSessionId as Uuid, PRINCIPAL);
    expect(ok.valid).toBe(true);

    // …and FAILS when a different principal presents the same session
    // (hard rule 30: principal-bound validation).
    const bad = await provider.validateSession(
      session.elevatedSessionId as Uuid,
      '00000000-0000-4000-a000-deadbeefdead'
    );
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/Principal mismatch/);
  });

  it('verify() rejects re-use of the same challenge', async () => {
    const { verifier } = makeVerifier(true);
    const provider = new ReferenceElevatedAuthProvider({
      credentialVerifier: verifier,
      dbPath: await tmpDbPath(),
    });
    const c = await provider.challenge({ principalId: PRINCIPAL, method: 'api_key_reauth' });
    await provider.verify({
      challengeId: c.challengeId as Uuid,
      principalId: PRINCIPAL,
      method: 'api_key_reauth',
      response: 'correct-key',
    });
    await expect(
      provider.verify({
        challengeId: c.challengeId as Uuid,
        principalId: PRINCIPAL,
        method: 'api_key_reauth',
        response: 'correct-key',
      })
    ).rejects.toThrow(/already consumed/);
  });
});

// Used only to keep the import for IsoTimestamp/NonEmpty in scope when
// tests refer to them via session shape (avoids unused-import lint).
type _Refs = IsoTimestamp | NonEmpty;
