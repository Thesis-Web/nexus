/**
 * Endpoint Manifest Loader — spec §26.5
 *
 * File: packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.ts
 * Layer 3 — imports from @nexus/contracts, @nexus/runtime-utils, zod.
 *
 * Loads, verifies, and validates the signed endpoint manifest at startup.
 * Returns an array of ModelEndpoint records for the runtime registry.
 *
 * Steps (per §26.5):
 *   1-3. File read + YAML parse + Ed25519 signature verify (via loadSignedManifest)
 *   4.   Schema validation (EndpointManifestBodySchema)
 *   5.   Per-entry validation loop:
 *        6.1  endpointId uniqueness
 *        6.2  adapterId registered in transport adapter registry
 *        6.3  (tier accepted as open governed string)
 *        6.4  forbidden adapterConfig keys
 *        6.5  per-adapter configSchema validation
 *   7.   secretRef resolvability for enabled entries (via SecretSource.canResolve)
 *   8.   Construct ModelEndpoint records
 *   9.   At-least-one-enabled invariant (fail closed)
 *
 * Fail-closed: any validation failure throws; NVG does not start.
 */
import type {
  ModelEndpoint,
  ModelTransportAdapterRegistry,
  SecretSource,
  IsoTimestamp,
  NonEmpty,
} from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { EndpointManifestBodySchema } from './endpoint-manifest-schema.js';

/**
 * Globally forbidden adapterConfig keys (§26.5 Step 6.4).
 * These keys are controlled at the endpoint or framework level and MUST NOT
 * appear in any adapter's adapterConfig. Checked BEFORE per-adapter schema.
 */
const FORBIDDEN_ADAPTER_CONFIG_KEYS = new Set([
  'stream',
  'streaming',
  'model',
  'messages',
  'auth',
  'url',
  'adapterId',
  'endpointId',
  'tier',
  'enabled',
  'healthy',
]);

export interface LoadEndpointManifestOptions {
  /** Path to the signed endpoint manifest YAML (§14.5) */
  manifestPath: string;
  /** Control-plane public key for signature verification (base64url Ed25519) */
  controlPlanePublicKey: string;
  /** Transport adapter registry — must be populated before calling this */
  adapterRegistry: ModelTransportAdapterRegistry;
  /** Secret source for secretRef resolvability checks */
  secretSource: SecretSource;
}

export async function loadEndpointManifest(
  opts: LoadEndpointManifestOptions
): Promise<ModelEndpoint[]> {
  // Steps 1-4: file read, YAML parse, signature verify, schema validate
  const result = await loadSignedManifest(
    opts.manifestPath,
    EndpointManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const endpoints: ModelEndpoint[] = [];
  const now = new Date().toISOString() as IsoTimestamp;

  for (const entry of body.endpoints) {
    // Disabled entries: skip validation, emit notice
    if (!entry.enabled) {
      // eslint-disable-next-line no-console
      console.info(`[endpoint-manifest] disabled endpoint: ${entry.endpointId} (skipped)`);
      continue;
    }

    // Step 6.1: endpointId uniqueness within manifest
    if (seenIds.has(entry.endpointId)) {
      throw new Error(`endpoint manifest: duplicate endpointId '${entry.endpointId}'`);
    }
    seenIds.add(entry.endpointId);

    // Step 6.2: adapterId registered in transport adapter registry
    const adapter = opts.adapterRegistry.get(entry.adapterId);
    if (adapter === null) {
      throw new Error(
        `endpoint manifest: adapterId '${entry.adapterId}' not registered` +
          ` (endpoint '${entry.endpointId}')`
      );
    }

    // Step 6.4: forbidden adapterConfig keys
    if (entry.adapterConfig !== undefined) {
      for (const key of Object.keys(entry.adapterConfig)) {
        if (FORBIDDEN_ADAPTER_CONFIG_KEYS.has(key)) {
          throw new Error(
            `endpoint manifest: adapterConfig.${key} is forbidden` +
              ` (endpoint '${entry.endpointId}')`
          );
        }
      }

      // Step 6.5: per-adapter configSchema validation
      const parseResult = adapter.configSchema.safeParse(entry.adapterConfig);
      if (!parseResult.success) {
        const issues = parseResult.error.issues
          .map(
            (i: { path: readonly (string | number)[]; message: string }) =>
              `${i.path.join('.')}: ${i.message}`
          )
          .join('; ');
        throw new Error(
          `endpoint manifest: adapterConfig validation failed for` +
            ` endpoint '${entry.endpointId}' (adapter '${entry.adapterId}'): ${issues}`
        );
      }
    }

    // Step 7: secretRef resolvability for auth-bearing endpoints
    if (entry.auth.kind !== 'none') {
      let canResolve: boolean;
      try {
        canResolve = await opts.secretSource.canResolve(entry.auth.secretRef);
      } catch (err: unknown) {
        throw new Error(
          `endpoint manifest: secret backend threw for secretRef` +
            ` '${entry.auth.secretRef}' (endpoint '${entry.endpointId}'): ` +
            (err instanceof Error ? err.message : 'unknown error')
        );
      }
      if (!canResolve) {
        throw new Error(
          `endpoint manifest: secretRef '${entry.auth.secretRef}' not resolvable` +
            ` (endpoint '${entry.endpointId}')`
        );
      }
    }

    // Step 8: construct ModelEndpoint
    // exactOptionalPropertyTypes: build required fields first, then
    // conditionally set optional properties that may be absent.
    const ep: ModelEndpoint = {
      endpointId: entry.endpointId as NonEmpty,
      tier: entry.tier as NonEmpty,
      url: entry.url as NonEmpty,
      adapterId: entry.adapterId as NonEmpty,
      modelName: entry.modelName as NonEmpty,
      auth: entry.auth as ModelEndpoint['auth'],
      healthy: true, // initial state — runtime health checks update this
      lastCheckAt: now,
    };
    if (entry.timeoutMs !== undefined) ep.timeoutMs = entry.timeoutMs;
    if (entry.maxConcurrentRequests !== undefined) {
      ep.maxConcurrentRequests = entry.maxConcurrentRequests;
    }
    if (entry.adapterConfig !== undefined) ep.adapterConfig = entry.adapterConfig;
    endpoints.push(ep);
  }

  // Step 9: at-least-one-enabled invariant
  if (endpoints.length === 0) {
    throw new Error(
      'endpoint manifest: zero enabled endpoints — NVG fails closed.' +
        ' Enable at least one endpoint or remove NVG from the deployment.'
    );
  }

  return endpoints;
}
