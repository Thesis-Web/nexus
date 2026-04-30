/**
 * Compile-Return Manifest Loader — AMEND-spec §4.6
 *
 * File: packages/core/src/manifest/output/compile-return-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loader invariants (§4.6):
 *   - At least one enabled return endpoint is required.
 *   - endpointType must resolve in CompileReturnTransportFactoryRegistry.
 *   - Duplicate returnEndpointId fails closed.
 *   - auth.kind must equal signed_callback for V1 (schema enforced).
 *   - acceptedArtifactTypes must include final_response.v1.
 *
 * Cross-manifest references (targetWorkspaceSocketId) are validated at
 * bootstrap Step 18, NOT at loader time.
 */
import type {
  CompileReturnTransportFactoryRegistry,
  CompileReturnEndpointRecord,
  NonEmpty,
} from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { CompileReturnManifestBodySchema } from './compile-return-manifest-schema.js';

export interface LoadCompileReturnManifestOptions {
  manifestPath: string;
  controlPlanePublicKey: string;
  factoryRegistry: CompileReturnTransportFactoryRegistry;
}

export async function loadCompileReturnManifest(
  opts: LoadCompileReturnManifestOptions
): Promise<CompileReturnEndpointRecord[]> {
  const result = await loadSignedManifest(
    opts.manifestPath,
    CompileReturnManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: CompileReturnEndpointRecord[] = [];

  for (const entry of body.returnEndpoints) {
    // Duplicate returnEndpointId fails closed
    if (seenIds.has(entry.returnEndpointId)) {
      throw new Error(
        `compile-return manifest: duplicate returnEndpointId '${entry.returnEndpointId}'`
      );
    }
    seenIds.add(entry.returnEndpointId);

    if (!entry.enabled) {
      console.info(
        `[compile-return-manifest] disabled endpoint: ${entry.returnEndpointId} (skipped)`
      );
      continue;
    }

    // acceptedArtifactTypes must include final_response.v1 (§4.6)
    if (!entry.acceptedArtifactTypes.includes('final_response.v1')) {
      throw new Error(
        `compile-return manifest: acceptedArtifactTypes must include 'final_response.v1'` +
          ` (endpoint '${entry.returnEndpointId}')`
      );
    }

    // endpointType registered in factory registry
    const factory = opts.factoryRegistry.get(entry.endpointType);
    if (factory === null) {
      throw new Error(
        `compile-return manifest: endpointType '${entry.endpointType}' not registered` +
          ` (endpoint '${entry.returnEndpointId}')`
      );
    }

    records.push({
      returnEndpointId: entry.returnEndpointId as NonEmpty,
      endpointType: entry.endpointType,
      enabled: entry.enabled,
      targetWorkspaceSocketId: entry.targetWorkspaceSocketId as NonEmpty,
      url: entry.url as NonEmpty,
      auth: {
        kind: entry.auth.kind,
        keyId: entry.auth.keyId as NonEmpty,
      },
      acceptedArtifactTypes: entry.acceptedArtifactTypes as NonEmpty[],
      configuration: entry.configuration,
    });
  }

  if (records.length === 0) {
    throw new Error(
      'compile-return manifest: zero enabled return endpoints — subsystem fails closed.' +
        ' Enable at least one compile-return endpoint in governed runtime mode.'
    );
  }

  return records;
}
