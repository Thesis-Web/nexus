/**
 * JWT Auth Provider Tests — spec §32.2, blueprint §7.4
 * Covers: valid JWT, expired JWT, bad signature, missing claims, wrong alg
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { JwtAuthProvider } from './jwt.js';
import type { NonEmpty } from '@nexus/contracts';

const TEST_SECRET = 'test-secret-must-be-at-least-32-chars-long!!';

/** Helper: build a signed HS256 JWT */
function makeJwt(
  payload: Record<string, unknown>,
  secret: string = TEST_SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  const enc = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${headerB64}.${payloadB64}.${sig}`;
}

describe('JwtAuthProvider — spec §32.2', () => {
  it('validates a well-formed JWT and returns sub', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt({
      sub: 'actor-jwt-001',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    const actorId = await provider.validate({
      type: 'jwt',
      value: token as NonEmpty,
    });
    expect(actorId).toBe('actor-jwt-001');
  });

  it('rejects expired tokens', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt({
      sub: 'actor-jwt-001',
      exp: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
    });

    await expect(provider.validate({ type: 'jwt', value: token as NonEmpty })).rejects.toThrow(
      'INVALID_JWT: token expired'
    );
  });

  it('rejects tokens with bad signature', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt(
      { sub: 'actor-jwt-001', exp: Math.floor(Date.now() / 1000) + 3600 },
      'wrong-secret-that-is-definitely-different'
    );

    await expect(provider.validate({ type: 'jwt', value: token as NonEmpty })).rejects.toThrow(
      'INVALID_JWT: signature verification failed'
    );
  });

  it('rejects tokens with missing sub claim', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(provider.validate({ type: 'jwt', value: token as NonEmpty })).rejects.toThrow(
      'INVALID_JWT: missing or empty sub claim'
    );
  });

  it('rejects tokens with missing exp claim', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt({ sub: 'actor-jwt-001' });

    await expect(provider.validate({ type: 'jwt', value: token as NonEmpty })).rejects.toThrow(
      'INVALID_JWT: missing exp claim'
    );
  });

  it('rejects non-HS256 algorithm', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);
    const token = makeJwt(
      { sub: 'actor-jwt-001', exp: Math.floor(Date.now() / 1000) + 3600 },
      TEST_SECRET,
      { alg: 'RS256', typ: 'JWT' }
    );

    await expect(provider.validate({ type: 'jwt', value: token as NonEmpty })).rejects.toThrow(
      'INVALID_JWT: only HS256 is supported'
    );
  });

  it('rejects non-jwt credential type', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);

    await expect(
      provider.validate({ type: 'api_key', value: 'some-key' as NonEmpty })
    ).rejects.toThrow('UNSUPPORTED_AUTH_TYPE');
  });

  it('rejects malformed token (wrong segment count)', async () => {
    const provider = new JwtAuthProvider(TEST_SECRET);

    await expect(
      provider.validate({ type: 'jwt', value: 'not.a.valid.jwt.token' as NonEmpty })
    ).rejects.toThrow('INVALID_JWT: expected three dot-separated segments');
  });

  it('constructor rejects short secrets', () => {
    expect(() => new JwtAuthProvider('short')).toThrow('JWT_SECRET_TOO_SHORT');
  });
});
