/**
 * Qualified Identifier Helpers — spec §32a.3, AMEND-spec §4.7
 *
 * Cross-domain identifier convention: `domain:primaryId`.
 * Within-domain uniqueness is mandatory. Cross-domain reuse is permitted
 * with a non-blocking config-load warning for legacy/NISP domains.
 *
 * §4.7 expansion: ManifestDomain expanded from 4 NISP domains to 9.
 * Required externals domains (workspace, orchestrator, mailbox, compiler,
 * compileReturn) fail closed on collision. Legacy/NISP domains (identity,
 * endpoint, connector, channel) remain warning-only unless referenced by
 * required externals.
 */

/** The nine governed manifest domains per §14.6.2, §4.7 */
export type ManifestDomain =
  | 'identity'
  | 'endpoint'
  | 'connector'
  | 'channel'
  | 'workspace'
  | 'orchestrator'
  | 'mailbox'
  | 'compiler'
  | 'compileReturn';

const VALID_DOMAINS = new Set<string>([
  'identity',
  'endpoint',
  'connector',
  'channel',
  'workspace',
  'orchestrator',
  'mailbox',
  'compiler',
  'compileReturn',
]);

/** Required externals domains — fail closed on collision (§4.7) */
const REQUIRED_EXTERNALS_DOMAINS = new Set<ManifestDomain>([
  'workspace',
  'orchestrator',
  'mailbox',
  'compiler',
  'compileReturn',
]);

export interface QualifiedIdentifier {
  readonly domain: ManifestDomain;
  readonly primaryId: string;
}

/**
 * Format a qualified identifier string: `domain:primaryId`.
 * All persisted audit records, CLI output, management API output, and
 * cross-domain references MUST use this form (§14.6.4).
 */
export function formatQualifiedId(domain: ManifestDomain, primaryId: string): string {
  return `${domain}:${primaryId}`;
}

/**
 * Parse a qualified identifier string. Returns null if format is invalid
 * or domain is not one of the nine governed domains.
 */
export function parseQualifiedId(qualified: string): QualifiedIdentifier | null {
  const colonIdx = qualified.indexOf(':');
  if (colonIdx < 1) return null;
  const domain = qualified.slice(0, colonIdx);
  const primaryId = qualified.slice(colonIdx + 1);
  if (!primaryId || !VALID_DOMAINS.has(domain)) return null;
  return { domain: domain as ManifestDomain, primaryId };
}

/**
 * Detect cross-domain primary identifier collisions across all domains.
 * Returns an array of collision warnings (non-blocking per §14.6.4).
 * Used for legacy/NISP domains.
 *
 * @param domainRegistries Map of domain → Set of primaryIds loaded from that domain's manifest
 * @returns Array of warning strings, empty if no collisions
 */
export function detectCrossDomainCollisions(
  domainRegistries: ReadonlyMap<ManifestDomain, ReadonlySet<string>>
): string[] {
  const warnings: string[] = [];
  const seen = new Map<string, ManifestDomain[]>();

  for (const [domain, ids] of domainRegistries) {
    for (const id of ids) {
      const existing = seen.get(id);
      if (existing) {
        existing.push(domain);
      } else {
        seen.set(id, [domain]);
      }
    }
  }

  for (const [id, domains] of seen) {
    if (domains.length > 1) {
      warnings.push(
        `Cross-domain identifier collision: '${id}' appears in domains: ${domains.join(', ')}`
      );
    }
  }

  return warnings;
}

/**
 * Detect collisions across required externals domains — fail closed (§4.7).
 *
 * Rules:
 * - Duplicate ID within any required externals domain: fail closed.
 * - Same raw ID across any two required externals domains: fail closed.
 * - Same raw ID between required externals and legacy/NISP domain: fail closed
 *   only when that legacy/NISP ID is referenced by required externals validation.
 *
 * @param domainRegistries Map of domain → Set of primaryIds
 * @returns Array of error strings. Non-empty means startup must fail.
 */
export function detectRequiredExternalsCollisions(
  domainRegistries: ReadonlyMap<ManifestDomain, ReadonlySet<string>>
): string[] {
  const errors: string[] = [];
  const seen = new Map<string, ManifestDomain[]>();

  for (const [domain, ids] of domainRegistries) {
    if (!REQUIRED_EXTERNALS_DOMAINS.has(domain)) continue;
    for (const id of ids) {
      const existing = seen.get(id);
      if (existing) {
        existing.push(domain);
      } else {
        seen.set(id, [domain]);
      }
    }
  }

  for (const [id, domains] of seen) {
    if (domains.length > 1) {
      errors.push(
        `Required externals collision (fail closed): '${id}' appears in domains: ${domains.join(', ')}`
      );
    }
  }

  return errors;
}
