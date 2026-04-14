/**
 * Target normalizer — spec §13.3, §19.2
 *
 * ADAPTER ENVIRONMENT LAW (blueprint §5.4):
 * Adapters MUST NOT set or override environment. Environment is authoritative from
 * actor registry only. This normalizer replaces any 'ACTOR_ENVIRONMENT' sentinel
 * with context.actor.environment. Raw targets from the MCP adapter carry
 * 'ACTOR_ENVIRONMENT' as a sentinel — Gate 02 calls normalize() with actor.environment.
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
      const system       = parts[0]?.trim() || 'unknown';
      const resourceType = parts[1]?.trim() || 'resource';
      const scope        = (parts[2]?.trim() as ResourceTarget['resourceScope']) ?? 'single';
      return {
        system,
        resourceType,
        resourceScope: this.normalizeScope(scope),
        environment:   actorEnvironment,
        externalFacing: false,
      };
    }

    // Fallback: treat entire string as system, derive resourceType from tool
    if (rawTarget.trim()) {
      return {
        system:         rawTarget.trim(),
        resourceType:   this.extractToolSuffix(tool),
        resourceScope:  'single',
        environment:    actorEnvironment,
        externalFacing: false,
      };
    }

    return null;
  }

  private fromParsed(
    obj: Record<string, unknown>,
    actorEnvironment: EnvironmentId
  ): ResourceTarget {
    const env = (obj['environment'] as string | undefined);
    return {
      system:         (obj['system']        as string) || 'unknown',
      resourceType:   (obj['resourceType']  as string) || 'resource',
      resourceScope:  this.normalizeScope((obj['resourceScope'] as string) ?? 'single'),
      // Replace ACTOR_ENVIRONMENT sentinel with authoritative actor environment
      environment:    (env === 'ACTOR_ENVIRONMENT' || !env) ? actorEnvironment : env,
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
