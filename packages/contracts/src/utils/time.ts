/**
 * Time and ID utilities — spec §12 canonical functions.
 * All timestamps are ISO 8601 UTC strings.
 *
 * Moved to contracts (Layer 2) so that adapters, connectors, and interfaces
 * can import them without violating §6.3 / §7.2 dependency law.
 *
 * Uses Web Crypto (globalThis.crypto.randomUUID) instead of node:crypto so
 * the contracts barrel is browser-safe — any value import from
 * @nexus/contracts in a Vite/Rollup-bundled client (e.g., the workspace
 * admin dashboard) used to fail because rollup externalizes 'crypto' for
 * the browser. Web Crypto is available in Node ≥19 (we require ≥20) and
 * in every modern browser in a secure context (the dashboard runs at
 * 127.0.0.1, which qualifies). Output is the same v4 UUID string.
 */
import type { Uuid, IsoTimestamp } from '../types/index.js';

export function uuid(): Uuid {
  return crypto.randomUUID() as Uuid;
}

export function newUuid(): Uuid {
  return crypto.randomUUID() as Uuid;
}

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function addSeconds(iso: IsoTimestamp, seconds: number): IsoTimestamp {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function isExpired(expiresAt: IsoTimestamp): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function durationMs(startIso: IsoTimestamp): number {
  return Date.now() - new Date(startIso).getTime();
}
