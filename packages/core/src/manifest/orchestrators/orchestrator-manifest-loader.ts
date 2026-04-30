/**
 * Orchestrator Manifest Loader — AMEND-spec §4.3
 *
 * File: packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loader invariants (§4.3):
 *   - At least one enabled orchestrator is required.
 *   - orchestratorType must resolve in OrchestratorFactoryRegistry.
 *   - Duplicate orchestratorSocketId fails closed.
 *   - orchestratorActorId must be syntactically UUID.
 *   - maxSplitDepth must be 0 or 1 for V1.
 *   - OCT-SECURE default must be single_agent_no_helper (schema enforced).
 *
 * Cross-manifest references (actor OCT check, etc.) are validated at
 * bootstrap Step 18 cross-reference check, NOT at loader time.
 */
import type {
  OrchestratorFactoryRegistry,
  OrchestratorManifestRecord,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { OrchestratorManifestBodySchema } from './orchestrator-manifest-schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LoadOrchestratorManifestOptions {
  manifestPath: string;
  controlPlanePublicKey: string;
  factoryRegistry: OrchestratorFactoryRegistry;
}

export async function loadOrchestratorManifest(
  opts: LoadOrchestratorManifestOptions
): Promise<OrchestratorManifestRecord[]> {
  const result = await loadSignedManifest(
    opts.manifestPath,
    OrchestratorManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: OrchestratorManifestRecord[] = [];

  for (const entry of body.orchestrators) {
    // Duplicate orchestratorSocketId fails closed (all entries, including disabled)
    if (seenIds.has(entry.orchestratorSocketId)) {
      throw new Error(
        `orchestrator manifest: duplicate orchestratorSocketId '${entry.orchestratorSocketId}'`
      );
    }
    seenIds.add(entry.orchestratorSocketId);

    if (!entry.enabled) {
      console.info(
        `[orchestrator-manifest] disabled orchestrator: ${entry.orchestratorSocketId} (skipped)`
      );
      continue;
    }

    // orchestratorActorId must be syntactically UUID (§4.3)
    if (!UUID_RE.test(entry.orchestratorActorId)) {
      throw new Error(
        `orchestrator manifest: orchestratorActorId '${entry.orchestratorActorId}' is not a valid UUID` +
          ` (orchestrator '${entry.orchestratorSocketId}')`
      );
    }

    // maxSplitDepth must be 0 or 1 for V1 (§4.3)
    if (entry.maxSplitDepth > 1) {
      throw new Error(
        `orchestrator manifest: maxSplitDepth ${entry.maxSplitDepth} exceeds V1 maximum of 1` +
          ` (orchestrator '${entry.orchestratorSocketId}')`
      );
    }

    // orchestratorType registered in factory registry
    const factory = opts.factoryRegistry.get(entry.orchestratorType);
    if (factory === null) {
      throw new Error(
        `orchestrator manifest: orchestratorType '${entry.orchestratorType}' not registered` +
          ` (orchestrator '${entry.orchestratorSocketId}')`
      );
    }

    records.push({
      orchestratorSocketId: entry.orchestratorSocketId as NonEmpty,
      orchestratorType: entry.orchestratorType as NonEmpty,
      enabled: entry.enabled,
      orchestratorActorId: entry.orchestratorActorId as Uuid,
      plannerMode: entry.plannerMode,
      maxSplitDepth: entry.maxSplitDepth,
      planCheckbackDefault: entry.planCheckbackDefault,
      secureMode: {
        octSecureDefault: entry.secureMode.octSecureDefault,
        allowSecureMultiAgentOnlyBySignedPolicy:
          entry.secureMode.allowSecureMultiAgentOnlyBySignedPolicy,
      },
      retryPolicy: {
        transientAutoRetryCount: entry.retryPolicy.transientAutoRetryCount,
      },
      timeouts: {
        systemActionMs: entry.timeouts.systemActionMs,
        modelCallMs: entry.timeouts.modelCallMs,
      },
      outputSlotPolicy: entry.outputSlotPolicy,
      configuration: entry.configuration,
    });
  }

  if (records.length === 0) {
    throw new Error(
      'orchestrator manifest: zero enabled orchestrators — subsystem fails closed.' +
        ' Enable at least one orchestrator in governed runtime mode.'
    );
  }

  return records;
}
