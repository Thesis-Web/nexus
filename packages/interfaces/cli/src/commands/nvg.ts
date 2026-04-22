/**
 * CLI NVG commands — spec §22.1
 * nexus nvg classify <request-json>
 * nexus nvg route <request-json>
 * nexus nvg trail [--run-id <id>]
 * nexus nvg policy validate <filepath>
 *
 * HOLE-S7-001 solve: commands depend on Layer 2 interfaces only.
 * NvgService and RoutingTrailReader are injected from bootstrap.
 */
import { promises as fs } from 'node:fs';
import {
  MODEL_TIER,
  type NvgService,
  type RoutingTrailReader,
  type NvgRoutingPolicy,
  type NvgOutboundRequest,
  type DataLabel,
  type OctLevel,
  type ModelTier,
} from '@nexus/contracts';

export async function cmdNvgClassify(requestJson: string, nvg: NvgService): Promise<void> {
  const input = JSON.parse(requestJson) as {
    dataLabels: DataLabel[];
    octLevel?: OctLevel;
    requestedTier?: ModelTier;
  };
  const classification = nvg.classify(input.dataLabels);
  console.log(`Data class: ${classification.effectiveDataClass}`);
  console.log(`Sensitive:  ${classification.isSensitive}`);
  console.log(`Labels:     ${classification.labels.length}`);
  if (input.octLevel) {
    const requestedTier = input.requestedTier ?? MODEL_TIER.FRONTIER_GENERAL;
    const ceiling = nvg.enforceOctCeiling(input.octLevel, requestedTier, classification);
    console.log(`OCT ceiling allowed: ${ceiling.allowed}`);
    if (!ceiling.allowed) {
      console.log(`  Denial: ${ceiling.denialCode} — ${ceiling.reason}`);
    }
  }
}

export async function cmdNvgRoute(requestJson: string, nvg: NvgService): Promise<void> {
  const input = JSON.parse(requestJson) as {
    policy: NvgRoutingPolicy;
    request: NvgOutboundRequest;
    dataLabels: DataLabel[];
  };
  const classification = nvg.classify(input.dataLabels);
  const decision = nvg.route(input.policy, input.request, classification);
  if (decision.matched) {
    console.log(`✓ Routed: rule=${decision.ruleId} → tier=${decision.routeTo}`);
    if (decision.fallbackTier) {
      console.log(`  Fallback: ${decision.fallbackTier}`);
    }
  } else {
    console.log('✗ Denied: no matching routing rule (default deny)');
  }
}

export async function cmdNvgTrail(
  opts: { runId?: string },
  trailReader: RoutingTrailReader
): Promise<void> {
  const entries = opts.runId
    ? await trailReader.getByRunId(opts.runId as any)
    : await trailReader.tail(20);
  if (entries.length === 0) {
    console.log('No trail entries found.');
    return;
  }
  for (const entry of entries) {
    console.log(
      `[${entry.timestamp}] ${entry.direction} | run=${entry.runId.slice(0, 12)}... | ` +
        `tier=${entry.modelTierSelected ?? 'none'} | ${entry.denialCode ?? 'ok'}`
    );
  }
  console.log(`\n${entries.length} entries`);
}

export async function cmdNvgPolicyValidate(
  filepath: string,
  loadPolicy: (fp: string) => Promise<NvgRoutingPolicy>
): Promise<void> {
  try {
    const policy = await loadPolicy(filepath);
    console.log(`✓ Policy ${policy.policyId} valid (signature verified, hard-wall checked)`);
    console.log(`  Version:  ${policy.version}`);
    console.log(`  Rules:    ${policy.rules.length}`);
    console.log(`  Issuer:   ${policy.issuer}`);
  } catch (err) {
    console.error(
      `✗ Policy validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
