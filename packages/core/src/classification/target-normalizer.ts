/**
 * Target normalizer — spec §13.3, §19.2
 *
 * ADAPTER ENVIRONMENT LAW (blueprint §24.5, spec §19.5):
 * Adapters MUST NOT set or override environment. Environment is authoritative from
 * actor registry only. This normalizer ALWAYS uses actorEnvironment — no exceptions.
 *
 * ENV-001 FIX: the fromParsed() path previously allowed non-sentinel environment
 * values from rawTarget JSON to pass through. Now ALL paths unconditionally use
 * actorEnvironment. Adapter-supplied environment is discarded — the actor registry
 * is the sole authority.
 */
import type { ResourceTarget, EnvironmentId } from '../types/index.js';

export class TargetNormalizer {
  normalize(
    rawTarget: string,
    tool: string,
    actorEnvironment: EnvironmentId
  ): ResourceTarget | null {
    // Try JSON parse first (MCP adapter encodes as JSON)
    try {
      const parsed = JSON.parse(rawTarget) as Record<string, unknown>;
      return this.fromParsed(parsed, actorEnvironment);
    } catch {
      // Fall through to string parsing
    }

    // Simple colon-separated: system:resourceType[:scope]
    const parts = rawTarget.split(':');
    if (parts.length >= 2) {
      const system = parts[0]?.trim() || 'unknown';
      const resourceType = parts[1]?.trim() || 'resource';
      const scope = (parts[2]?.trim() as ResourceTarget['resourceScope']) ?? 'single';
      return {
        system,
        resourceType,
        resourceScope: this.normalizeScope(scope),
        environment: actorEnvironment,
        externalFacing: false,
      };
    }

    // Fallback: treat entire string as system, derive resourceType from tool
    if (rawTarget.trim()) {
      return {
        system: rawTarget.trim(),
        resourceType: this.extractToolSuffix(tool),
        resourceScope: 'single',
        environment: actorEnvironment,
        externalFacing: false,
      };
    }

    return null;
  }

  private fromParsed(
    obj: Record<string, unknown>,
    actorEnvironment: EnvironmentId
  ): ResourceTarget {
    // ENV-001 FIX: ALWAYS use actorEnvironment. Adapter-supplied environment is NEVER trusted.
    // Blueprint §24.5: "Adapters MUST NOT set or override environment."
    // Any environment value in rawTarget JSON is discarded.
    return {
      system: (obj['system'] as string) || 'unknown',
      resourceType: (obj['resourceType'] as string) || 'resource',
      resourceScope: this.normalizeScope((obj['resourceScope'] as string) ?? 'single'),
      environment: actorEnvironment,
      externalFacing: Boolean(obj['externalFacing']),
    };
  }

  private normalizeScope(raw: string): ResourceTarget['resourceScope'] {
    const scopes: ResourceTarget['resourceScope'][] = ['single', 'bulk', 'collection', 'system'];
    return scopes.includes(raw as ResourceTarget['resourceScope'])
      ? (raw as ResourceTarget['resourceScope'])
      : 'single';
  }

  private extractToolSuffix(tool: string): string {
    const parts = tool.toLowerCase().split('_').filter(Boolean);
    return parts[parts.length - 1] ?? 'resource';
  }
}
