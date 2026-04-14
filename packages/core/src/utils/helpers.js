/**
 * General utility helpers — spec §10 primitives.
 */
import { randomUUID } from 'crypto';
export function newUuid() {
    return randomUUID();
}
/**
 * Truncate a string to maxLen chars, appending '…' if truncated.
 * Used for intent/summary fields that have character limits.
 */
export function truncate(s, maxLen) {
    if (s.length <= maxLen)
        return s;
    return s.slice(0, maxLen - 1) + '…';
}
/**
 * Assert a value is non-empty string. Throws on empty or non-string.
 */
export function assertNonEmpty(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} must be a non-empty string`);
    }
    return value;
}
/**
 * Strip undefined-valued keys from an object.
 * Required before any canonicalize() call — undefined is illegal in canonical payloads. (SOLVE-004)
 */
export function stripUndefined(obj) {
    const result = {};
    for (const key of Object.keys(obj)) {
        if (obj[key] !== undefined) {
            result[key] = obj[key];
        }
    }
    return result;
}
