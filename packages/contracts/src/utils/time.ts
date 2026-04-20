/**
 * Time and ID utilities — spec §12 canonical functions.
 * All timestamps are ISO 8601 UTC strings.
 *
 * Moved to contracts (Layer 2) so that adapters, connectors, and interfaces
 * can import them without violating §6.3 / §7.2 dependency law.
 * These functions use only Node.js built-ins — no monorepo imports.
 */
import { randomUUID } from 'crypto';
import type { Uuid, IsoTimestamp } from '../types/index.js';

export function uuid(): Uuid {
  return randomUUID();
}

export function newUuid(): Uuid {
  return randomUUID();
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
