/**
 * Compiler Manifest Loader — AMEND-spec §4.5
 *
 * File: packages/core/src/manifest/compile/compiler-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loader invariants (§4.5):
 *   - At least one enabled compiler is required.
 *   - compilerType must resolve in CompilerFactoryRegistry.
 *   - Duplicate compilerSocketId fails closed.
 *   - octMode must equal OCT-COMPILE (schema enforced).
 *   - If actorRegistration = exempt_reference_deterministic_renderer:
 *     compilerType must = reference_deterministic_renderer,
 *     compilerActorId must be null,
 *     allowedModes must = ['deterministic_render'].
 *   - If actorRegistration = required:
 *     compilerActorId must be a UUID.
 *   - artifactSigning.kind = control_plane for reference, actor_registry_key for non-ref.
 *
 * Cross-manifest references (readsFromMailboxId resolution, actor OCT check)
 * are validated at bootstrap Step 18, NOT at loader time.
 */
import type {
  CompilerFactoryRegistry,
  CompilerManifestRecord,
  CompileMode,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { CompilerManifestBodySchema } from './compiler-manifest-schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LoadCompilerManifestOptions {
  manifestPath: string;
  controlPlanePublicKey: string;
  factoryRegistry: CompilerFactoryRegistry;
}

export async function loadCompilerManifest(
  opts: LoadCompilerManifestOptions
): Promise<CompilerManifestRecord[]> {
  const result = await loadSignedManifest(
    opts.manifestPath,
    CompilerManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: CompilerManifestRecord[] = [];

  for (const entry of body.compilers) {
    // Duplicate compilerSocketId fails closed
    if (seenIds.has(entry.compilerSocketId)) {
      throw new Error(`compiler manifest: duplicate compilerSocketId '${entry.compilerSocketId}'`);
    }
    seenIds.add(entry.compilerSocketId);

    if (!entry.enabled) {
      console.info(`[compiler-manifest] disabled compiler: ${entry.compilerSocketId} (skipped)`);
      continue;
    }

    // actorRegistration invariants (§4.5)
    if (entry.actorRegistration === 'exempt_reference_deterministic_renderer') {
      if (entry.compilerType !== 'reference_deterministic_renderer') {
        throw new Error(
          `compiler manifest: exempt_reference_deterministic_renderer requires compilerType` +
            ` 'reference_deterministic_renderer', got '${entry.compilerType}'` +
            ` (compiler '${entry.compilerSocketId}')`
        );
      }
      if (entry.compilerActorId !== null) {
        throw new Error(
          `compiler manifest: exempt_reference_deterministic_renderer requires` +
            ` compilerActorId null (compiler '${entry.compilerSocketId}')`
        );
      }
      if (entry.allowedModes.length !== 1 || entry.allowedModes[0] !== 'deterministic_render') {
        throw new Error(
          `compiler manifest: exempt_reference_deterministic_renderer requires` +
            ` allowedModes ['deterministic_render']` +
            ` (compiler '${entry.compilerSocketId}')`
        );
      }
      if (entry.artifactSigning.kind !== 'control_plane') {
        throw new Error(
          `compiler manifest: reference deterministic compiler requires` +
            ` artifactSigning.kind 'control_plane'` +
            ` (compiler '${entry.compilerSocketId}')`
        );
      }
    } else {
      // actorRegistration = 'required'
      if (entry.compilerActorId === null || !UUID_RE.test(entry.compilerActorId)) {
        throw new Error(
          `compiler manifest: actorRegistration 'required' requires a valid UUID` +
            ` compilerActorId (compiler '${entry.compilerSocketId}')`
        );
      }
      if (entry.artifactSigning.kind !== 'actor_registry_key') {
        throw new Error(
          `compiler manifest: non-reference compiler requires` +
            ` artifactSigning.kind 'actor_registry_key'` +
            ` (compiler '${entry.compilerSocketId}')`
        );
      }
    }

    // compilerType registered in factory registry
    const factory = opts.factoryRegistry.get(entry.compilerType);
    if (factory === null) {
      throw new Error(
        `compiler manifest: compilerType '${entry.compilerType}' not registered` +
          ` (compiler '${entry.compilerSocketId}')`
      );
    }

    records.push({
      compilerSocketId: entry.compilerSocketId as NonEmpty,
      compilerType: entry.compilerType as NonEmpty,
      enabled: entry.enabled,
      actorRegistration: entry.actorRegistration,
      compilerActorId: (entry.compilerActorId as Uuid) ?? null,
      octMode: entry.octMode,
      allowedModes: entry.allowedModes as CompileMode[],
      readsFromMailboxId: entry.readsFromMailboxId as NonEmpty,
      outputContractVersion: entry.outputContractVersion,
      artifactSigning:
        entry.artifactSigning.kind === 'control_plane'
          ? { kind: 'control_plane' as const }
          : {
              kind: 'actor_registry_key' as const,
              keyId: entry.artifactSigning.keyId as NonEmpty,
            },
      configuration: entry.configuration,
    });
  }

  if (records.length === 0) {
    throw new Error(
      'compiler manifest: zero enabled compilers — subsystem fails closed.' +
        ' Enable at least one compiler in governed runtime mode.'
    );
  }

  return records;
}
