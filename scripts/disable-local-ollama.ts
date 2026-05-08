#!/usr/bin/env tsx
/**
 * One-off: disable known-unreachable / non-responsive ollama endpoints so
 * the single-shot fallback in packages/vanguard/src/router/model-router.ts
 * lands on a working LAN endpoint.
 *
 * - local-ollama (localhost:11434) is unreachable from WSL.
 * - ollama-blackmac (10.31.1.137) hosts qwen3.5:0.8b but the model hangs
 *   beyond the 60s plan-node timeout on cold-load, so the demo never
 *   completes.
 *
 * The remaining on_prem_general endpoints (ollama-jameshp, ollama-jamesImac)
 * stay enabled. Single-shot fallback then targets the first registered
 * healthy endpoint of the fallback tier.
 */
import { ManifestWriterService } from '../packages/core/src/manifest/manifest-writer-service.js';
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';

const TO_DISABLE: readonly string[] = ['local-ollama', 'ollama-blackmac'];

async function main(): Promise<void> {
  const kp = await loadControlPlaneKey();
  const w = new ManifestWriterService({ privateKey: kp.privateKey, issuer: 'nexus-dev' });
  for (const endpointId of TO_DISABLE) {
    const result = await w.updateEntry(
      'config/nvg/endpoints.v1.yaml',
      'endpoints',
      endpointId,
      { enabled: false },
      'endpointId'
    );
    const ep = result.find(e => e['endpointId'] === endpointId);
    console.log(`${endpointId} enabled = ${ep?.['enabled']}`);
  }
}

void main().catch(err => {
  console.error(err);
  process.exit(1);
});
