/**
 * Output Digest Helpers — AMEND-spec §3.7, §8.4
 *
 * File: packages/core/src/output/output-digest.ts
 * Layer 1 — SHA-256 digest computation for output contracts and artifacts.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from '@nexus/runtime-utils';
import type { Sha256Hex } from '@nexus/contracts';

export function sha256Hex(data: Uint8Array | string): Sha256Hex {
  const hash = createHash('sha256');
  hash.update(typeof data === 'string' ? data : Buffer.from(data));
  return hash.digest('hex') as Sha256Hex;
}

export function sha256Canonical(obj: Record<string, unknown>): Sha256Hex {
  const canonical = canonicalize(obj);
  return sha256Hex(canonical);
}
