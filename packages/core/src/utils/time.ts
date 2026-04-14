import { randomUUID } from 'crypto';
export function uuid(): string {
  return randomUUID();
}
/**
 * Time utilities — spec §10 canonical time functions.
 * All timestamps are ISO 8601 UTC strings.
 */
import type { IsoTimestamp } from '../types/index.js';

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
