/**
 * deterministic-replay.test.ts — §27.6, §31.5
 * ADD-003 owner-approved 2026-04-14.
 * Runs scenarios 01, 02, 03 twice each independently.
 * Asserts CCV comparable fields (§14.4) are byte-identical.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { runScenario } from './scenarios.integration.test.js';
import type { KeyPair, CompilerComparisonView, ScenarioId } from '../types/index.js';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

function comparable(ccv: CompilerComparisonView) {
  return {
    blueprintVersion: ccv.meta.blueprintVersion,
    runtimeContractVersion: ccv.meta.runtimeContractVersion,
    capabilityTaxonomyVersion: ccv.meta.capabilityTaxonomyVersion,
    comparisonInputVersion: ccv.meta.comparisonInputVersion,
    normalizedActionHash: ccv.meta.normalizedActionHash,
    actorClass: ccv.identity.actorClass,
    environment: ccv.identity.environment,
    capabilityId: ccv.classification.capabilityId,
  };
}

describe('Deterministic replay — §27.6 §31.5', () => {
  const SCENARIOS: ScenarioId[] = ['01-allow-read', '02-allow-create', '03-approval-approved'];

  for (const id of SCENARIOS) {
    it(`${id}: CCV comparable fields byte-identical on independent re-runs`, async () => {
      const opts = { approvalDecision: 'approved' as const };
      const r1 = await runScenario(id, opts);
      const r2 = await runScenario(id, opts);
      expect(comparable(r1.evidenceRecord.compilerView)).toEqual(
        comparable(r2.evidenceRecord.compilerView)
      );
      // Full CCV equality NOT asserted — UUIDs (delegationContextId,
      // executionGrantId) and derived hashes are freshly minted each run.
      // Canon law §14.4 + deviation memo: comparable fields only.
    }, 30_000);
  }
});
