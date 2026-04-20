/**
 * Time and ID utilities — spec §12 canonical functions.
 *
 * DEF-001: Canonical implementation moved to @nexus/contracts (Layer 2).
 * This file re-exports so existing core-internal imports continue to resolve.
 */
export { uuid, newUuid, nowIso, addSeconds, isExpired, sleep, durationMs } from '@nexus/contracts';
