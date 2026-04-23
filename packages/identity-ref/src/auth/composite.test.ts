/**
 * Composite Auth Provider Tests — BS-D2-008 Part A
 * Covers: dispatch to api-key, dispatch to jwt, unsupported type,
 * no provider registered, last-registration-wins
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { CompositeAuthProvider } from './composite.js';
import { ApiKeyAuthProvider } from './api-key.js';
import { JwtAuthProvider } from './jwt.js';
import type { NonEmpty } from '@nexus/contracts';

const TEST_SECRET = 'test-secret-must-be-at-least-32-chars-long!!';

/** Helper: build a signed HS256 JWT */
function makeJwt(payload: Record<string, unknown>, secret: string = TEST_SECRET): string {
  const enc = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64 = enc({ alg: 'HS256', typ: 'JWT' });
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

describe('CompositeAuthProvider — BS-D2-008', () => {
  let composite: CompositeAuthProvider;
  let apiKeyProvider: ApiKeyAuthProvider;
  let jwtProvider: JwtAuthProvider;

  beforeEach(() => {
    composite = new CompositeAuthProvider();
    apiKeyProvider = new ApiKeyAuthProvider();
    jwtProvider = new JwtAuthProvider(TEST_SECRET);

    apiKeyProvider.registerKey('key-001', 'actor-from-apikey');
    composite.registerProvider('api_key', apiKeyProvider);
    composite.registerProvider('jwt', jwtProvider);
  });

  it('dispatches api_key credentials to ApiKeyAuthProvider', async () => {
    const result = await composite.validate({
      type: 'api_key',
      value: 'key-001' as NonEmpty,
    });
    expect(result).toBe('actor-from-apikey');
  });

  it('dispatches jwt credentials to JwtAuthProvider', async () => {
    const token = makeJwt({
      sub: 'actor-from-jwt',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    const result = await composite.validate({
      type: 'jwt',
      value: token as NonEmpty,
    });
    expect(result).toBe('actor-from-jwt');
  });

  it('throws UNSUPPORTED_AUTH_TYPE for oauth_token (no provider registered)', async () => {
    await expect(
      composite.validate({
        type: 'oauth_token',
        value: 'some-token' as NonEmpty,
      })
    ).rejects.toThrow('UNSUPPORTED_AUTH_TYPE');
    await expect(
      composite.validate({
        type: 'oauth_token',
        value: 'some-token' as NonEmpty,
      })
    ).rejects.toThrow("'oauth_token'");
  });

  it('throws when no providers are registered at all', async () => {
    const empty = new CompositeAuthProvider();
    await expect(
      empty.validate({
        type: 'api_key',
        value: 'key-001' as NonEmpty,
      })
    ).rejects.toThrow('UNSUPPORTED_AUTH_TYPE');
  });

  it('propagates underlying provider errors (invalid api key)', async () => {
    await expect(
      composite.validate({
        type: 'api_key',
        value: 'bad-key' as NonEmpty,
      })
    ).rejects.toThrow('INVALID_API_KEY');
  });

  it('propagates underlying provider errors (expired jwt)', async () => {
    const expired = makeJwt({
      sub: 'actor',
      exp: Math.floor(Date.now() / 1000) - 100,
      iat: Math.floor(Date.now() / 1000) - 200,
    });
    await expect(
      composite.validate({
        type: 'jwt',
        value: expired as NonEmpty,
      })
    ).rejects.toThrow('INVALID_JWT: token expired');
  });

  it('last registration wins for same credential type', async () => {
    const secondApiKey = new ApiKeyAuthProvider();
    secondApiKey.registerKey('override-key', 'actor-override');
    composite.registerProvider('api_key', secondApiKey);

    // Old key no longer works
    await expect(
      composite.validate({
        type: 'api_key',
        value: 'key-001' as NonEmpty,
      })
    ).rejects.toThrow('INVALID_API_KEY');

    // New key works
    const result = await composite.validate({
      type: 'api_key',
      value: 'override-key' as NonEmpty,
    });
    expect(result).toBe('actor-override');
  });
});
