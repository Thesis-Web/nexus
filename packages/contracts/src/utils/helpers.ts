/**
 * General utility helpers — spec §12 primitives.
 *
 * Moved to contracts (Layer 2) so that adapters, connectors, and interfaces
 * can import them without violating §6.3 / §7.2 dependency law.
 * These functions use only native JS — no monorepo imports.
 */

/**
 * Truncate a string to maxLen chars, appending '…' if truncated.
 * Used for intent/summary fields that have character limits.
 */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/**
 * Assert a value is non-empty string. Throws on empty or non-string.
 */
export function assertNonEmpty(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

/**
 * Strip undefined-valued keys from an object.
 * Required before any canonicalize() call — undefined is illegal
 * in canonical payloads. (SOLVE-004)
 */
export function stripUndefined<T extends object>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}
