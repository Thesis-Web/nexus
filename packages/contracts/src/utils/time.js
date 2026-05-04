/**
 * Time and ID utilities — spec §12 canonical functions.
 * All timestamps are ISO 8601 UTC strings.
 *
 * Moved to contracts (Layer 2) so that adapters, connectors, and interfaces
 * can import them without violating §6.3 / §7.2 dependency law.
 * These functions use only Node.js built-ins — no monorepo imports.
 */
import { randomUUID } from 'crypto';
export function uuid() {
    return randomUUID();
}
export function newUuid() {
    return randomUUID();
}
export function nowIso() {
    return new Date().toISOString();
}
export function addSeconds(iso, seconds) {
    return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
export function isExpired(expiresAt) {
    return new Date(expiresAt).getTime() <= Date.now();
}
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function durationMs(startIso) {
    return Date.now() - new Date(startIso).getTime();
}
