/**
 * Orchestrator Manifest Loader — AMEND-spec §4.3
 * AMEND-spec-nexus-orch §4.2 — Extended manifest fields
 *
 * File: packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loader invariants (§4.3):
 *   - At least one enabled orchestrator is required.
 *   - orchestratorType must resolve in OrchestratorFactoryRegistry.
 *   - Duplicate orchestratorSocketId fails closed.
 *   - orchestratorActorId must be syntactically UUID.
 *   - maxSplitDepth is gated by a plannertype-scoped allowance table.
 *     - Default allowance: 1 (legacy V1 cap).
 *     - 'db-lexicon-transformer-v0' allowance: 3 (worked example is 3
 *       nodes; AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7.1, log
 *       ADD-PLANNER-LEXICON-005).
 *     - Values exceeding the plannertype-specific allowance fail closed.
 *   - OCT-SECURE default must be single_agent_no_helper (schema enforced).
 *   - partialCompletion.compileOnPartial must be false when
 *     partialCompletion.enabled is false [AMEND-spec-nexus-orch §4.8.1].
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

// ─── maxSplitDepth allowance by plannerType ───
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7.1, log ADD-PLANNER-LEXICON-005.
// Default V1 cap of 1 remains for any plannertype not listed; the
// lexicon planner's worked example is 3 nodes (read → adjust → write).
// New plannertypes append their own allowance rather than widen the
// default — keeps the legacy ceiling intact and the new ceiling
// plannertype-scoped.
const MAX_SPLIT_DEPTH_BY_PLANNER: Record<string, number> = {
  'db-lexicon-transformer-v0': 3,
};
const DEFAULT_MAX_SPLIT_DEPTH = 1;

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

    // maxSplitDepth is plannertype-scoped per
    // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7.1.
    const allowedMax = MAX_SPLIT_DEPTH_BY_PLANNER[entry.plannerType] ?? DEFAULT_MAX_SPLIT_DEPTH;
    if (entry.maxSplitDepth > allowedMax) {
      throw new Error(
        `orchestrator manifest: maxSplitDepth ${entry.maxSplitDepth} exceeds ` +
          `allowed maximum of ${allowedMax} for plannerType '${entry.plannerType}' ` +
          `(orchestrator '${entry.orchestratorSocketId}')`
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

    // §4.8.1: compileOnPartial must be false when enabled is false
    if (!entry.partialCompletion.enabled && entry.partialCompletion.compileOnPartial) {
      throw new Error(
        `orchestrator manifest: partialCompletion.compileOnPartial is true but ` +
          `partialCompletion.enabled is false — impossible state` +
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
      // ── AMEND-spec-nexus-orch §4.2 — new manifest fields ──
      plannerType: entry.plannerType as NonEmpty,
      plannerVersion: entry.plannerVersion as NonEmpty,
      plannerConfiguration: entry.plannerConfiguration,
      planAmendment: {
        enabled: entry.planAmendment.enabled,
        maxAmendments: entry.planAmendment.maxAmendments,
        requiresCheckback: entry.planAmendment.requiresCheckback,
      },
      partialCompletion: {
        enabled: entry.partialCompletion.enabled,
        minRequiredCompletedNodes: entry.partialCompletion.minRequiredCompletedNodes,
        compileOnPartial: entry.partialCompletion.compileOnPartial,
      },
      maxToolTurnsPerNode: entry.maxToolTurnsPerNode,
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
