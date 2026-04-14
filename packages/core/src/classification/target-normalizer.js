export class TargetNormalizer {
    normalize(rawTarget, tool, actorEnvironment) {
        // Try JSON parse first (MCP adapter encodes as JSON)
        try {
            const parsed = JSON.parse(rawTarget);
            return this.fromParsed(parsed, actorEnvironment);
        }
        catch {
            // Fall through to string parsing
        }
        // Simple colon-separated: system:resourceType[:scope]
        const parts = rawTarget.split(':');
        if (parts.length >= 2) {
            const system = parts[0]?.trim() || 'unknown';
            const resourceType = parts[1]?.trim() || 'resource';
            const scope = parts[2]?.trim() ?? 'single';
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
    fromParsed(obj, actorEnvironment) {
        const env = obj['environment'];
        return {
            system: obj['system'] || 'unknown',
            resourceType: obj['resourceType'] || 'resource',
            resourceScope: this.normalizeScope(obj['resourceScope'] ?? 'single'),
            // Replace ACTOR_ENVIRONMENT sentinel with authoritative actor environment
            environment: env === 'ACTOR_ENVIRONMENT' || !env ? actorEnvironment : env,
            externalFacing: Boolean(obj['externalFacing']),
        };
    }
    normalizeScope(raw) {
        const scopes = ['single', 'bulk', 'collection', 'system'];
        return scopes.includes(raw)
            ? raw
            : 'single';
    }
    extractToolSuffix(tool) {
        const parts = tool.toLowerCase().split('_').filter(Boolean);
        return parts[parts.length - 1] ?? 'resource';
    }
}
