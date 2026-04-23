/**
 * Reference Auth Provider — JWT — spec §32.2, blueprint §7.4
 * Signed JWT authentication for starter deployments.
 * HMAC-SHA256 with shared secret. Not for production.
 * Layer 6 internal — not exported to contracts.
 *
 * "Reference Identity Adapter — starter only.
 *  Not for production deployments with enterprise IAM or RBAC in place."
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { AuthCredentials, NonEmpty } from '@nexus/contracts';
import type { ReferenceAuthProvider } from './api-key.js';

/**
 * JWT payload shape expected by the reference adapter.
 * `sub` is the actor identifier. `exp` is Unix epoch seconds.
 */
interface JwtPayload {
  sub: string;
  exp: number;
  iat?: number;
  iss?: string;
}

/**
 * Base64url decode (RFC 7515 §2).
 */
function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * Reference JWT auth provider.
 * Validates HMAC-SHA256 JWTs and returns the `sub` claim as the actor identifier.
 *
 * Production upgrade: replace with asymmetric RS256/ES256 verification
 * backed by enterprise JWKS endpoint.
 */
export class JwtAuthProvider implements ReferenceAuthProvider {
  constructor(private readonly sharedSecret: string) {
    if (!sharedSecret || sharedSecret.length < 32) {
      throw new Error('JWT_SECRET_TOO_SHORT: shared secret must be at least 32 characters');
    }
  }

  async validate(credentials: AuthCredentials): Promise<NonEmpty> {
    if (credentials.type !== 'jwt') {
      throw new Error('UNSUPPORTED_AUTH_TYPE: JwtAuthProvider handles jwt only');
    }

    const parts = credentials.value.split('.');
    if (parts.length !== 3) {
      throw new Error('INVALID_JWT: expected three dot-separated segments');
    }

    const headerB64 = parts[0]!;
    const payloadB64 = parts[1]!;
    const signatureB64 = parts[2]!;

    // ── Verify header declares HS256 ──
    const header = JSON.parse(base64urlDecode(headerB64).toString('utf-8')) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== 'HS256') {
      throw new Error('INVALID_JWT: only HS256 is supported by the reference adapter');
    }

    // ── Verify HMAC-SHA256 signature ──
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac('sha256', this.sharedSecret).update(signingInput).digest();
    const actualSig = base64urlDecode(signatureB64);

    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
      throw new Error('INVALID_JWT: signature verification failed');
    }

    // ── Decode and validate payload ──
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8')) as JwtPayload;

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('INVALID_JWT: missing or empty sub claim');
    }

    if (typeof payload.exp !== 'number') {
      throw new Error('INVALID_JWT: missing exp claim');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSeconds) {
      throw new Error('INVALID_JWT: token expired');
    }

    return payload.sub as NonEmpty;
  }
}
