/**
 * Rate limiter — spec §17
 *
 * OPERATOR NOTE: This is a single-process in-memory rate limiter.
 * It does not coordinate across multiple processes or nodes.
 * In a multi-process deployment, replace with a shared backend (Redis, etc.).
 * This limitation is intentional for the POC single-node runtime.
 */
import { DENIAL_CODE } from '../types/index.js';
import { NexusSecurityViolation } from '../types/index.js';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly store = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maxPerWindow: number = 60,
    private readonly windowMs: number = 60_000
  ) {}

  check(key: string): void {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.store.set(key, { count: 1, windowStart: now });
      return;
    }

    entry.count += 1;
    if (entry.count > this.maxPerWindow) {
      throw new NexusSecurityViolation(
        DENIAL_CODE.RATE_LIMIT_EXCEEDED,
        `rate limit exceeded for key ${key}: ${entry.count} requests in window`
      );
    }
  }
}
