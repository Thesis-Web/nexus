/**
 * Canonical serialization — spec §15.5, §32a.0.1
 *
 * Physical implementation lives here in runtime-utils per owner ratification
 * S10-T3 (HOLE-S10-001 CLOSED). packages/core/src/crypto/canonicalize.ts
 * re-exports from this module for backward compatibility.
 *
 * PROHIBITION: JSON.stringify(obj, Object.keys(obj).sort()) is PROHIBITED throughout
 * the codebase. All signature, hash, and fingerprint computation must use this function.
 *
 * SOLVE-004: undefined is illegal in canonical payloads. Keys with undefined values
 * are stripped. Non-key undefined (array element, top-level) throws.
 *
 * Blueprint drift prevention: "do not let canonicalization for signing or hashing be non-recursive"
 */
export function canonicalize(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) {
    throw new TypeError(
      'canonicalize: undefined is not a legal canonical value — use null or omit the field'
    );
  }
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return (
      '[' +
      val
        .map(v => {
          if (v === undefined) {
            throw new TypeError(
              'canonicalize: undefined element in array — use null or remove the element'
            );
          }
          return canonicalize(v);
        })
        .join(',') +
      ']'
    );
  }
  const obj = val as Record<string, unknown>;
  // Strip keys whose value is undefined — they are not part of the canonical payload.
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]!));
  return '{' + pairs.join(',') + '}';
}
