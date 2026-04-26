/**
 * Qualified Identifier Helpers — spec §32a.3
 *
 * Cross-domain identifier convention: `domain:primaryId`.
 * Within-domain uniqueness is mandatory. Cross-domain reuse is permitted
 * with a non-blocking config-load warning.
 *
 * Governed domains (§14.6.4):
 *   identity:<providerId>
 *   endpoint:<endpointId>
 *   connector:<connectorId>
 *   channel:<channelId>
 */

/** The four governed manifest domains per §14.6.2 */
export type ManifestDomain = 'identity' | 'endpoint' | 'connector' | 'channel';

const VALID_DOMAINS = new Set<string>(['identity', 'endpoint', 'connector', 'channel']);

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
 * or domain is not one of the four governed domains.
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
 * Detect cross-domain primary identifier collisions across all four domains.
 * Returns an array of collision warnings (non-blocking per §14.6.4).
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
