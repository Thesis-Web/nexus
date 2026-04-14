/**
 * Threat test 7 — Policy Manipulation: Unsigned Policy
 * Spec §12.3, §27.2 item 7
 * loadPolicyFile(path, controlPlaneKey) — takes 2 args; key is not loaded internally.
 * Unsigned or tampered policy → PolicySignatureError.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadPolicyFile } from '../policy/rule-loader.js';
import { PolicySignatureError } from '../types/index.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import type { KeyPair } from '../types/index.js';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

const tmpPaths: string[] = [];
afterEach(async () => {
  for (const p of tmpPaths) await fs.unlink(p).catch(() => {});
  tmpPaths.length = 0;
});

function makeTmpPath(): string {
  const p = path.join(os.tmpdir(), 'nexus-policy-unsigned-' + randomUUID() + '.json');
  tmpPaths.push(p);
  return p;
}

describe('Threat: Policy Manipulation — Unsigned Policy (spec §12.3)', () => {
  it('throws PolicySignatureError when policy signature is missing (empty string)', async () => {
    const policyPath = makeTmpPath();
    const unsignedPolicy = {
      policyId: randomUUID(),
      version: 'v0.1.0',
      blueprintVersion: 'v0.3.6',
      runtimeContractVersion: 'v0.4.6',
      capabilityTaxonomyVersion: 'v0.1.0',
      rules: [
        {
          ruleId: randomUUID(),
          priority: 100,
          outcome: 'allow',
          conditions: { riskTiers: ['low'] },
          grantHint: null,
          approvalConfig: null,
        },
      ],
      signature: '',
    };
    await fs.writeFile(policyPath, JSON.stringify(unsignedPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath, controlPlanePair)).rejects.toThrow(
      PolicySignatureError
    );
  });

  it('throws PolicySignatureError when policy signature is invalid (tampered)', async () => {
    const policyPath = makeTmpPath();
    const tamperedPolicy = {
      policyId: randomUUID(),
      version: 'v0.1.0',
      blueprintVersion: 'v0.3.6',
      runtimeContractVersion: 'v0.4.6',
      capabilityTaxonomyVersion: 'v0.1.0',
      rules: [],
      signature:
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    await fs.writeFile(policyPath, JSON.stringify(tamperedPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath, controlPlanePair)).rejects.toThrow(
      PolicySignatureError
    );
  });

  it('does not load a policy file signed with a different (wrong) key', async () => {
    const policyPath = makeTmpPath();
    const wrongKeyPolicy = {
      policyId: randomUUID(),
      version: 'v0.1.0',
      blueprintVersion: 'v0.3.6',
      runtimeContractVersion: 'v0.4.6',
      capabilityTaxonomyVersion: 'v0.1.0',
      rules: [],
      signature: 'ZmFrZXNpZ25hdHVyZWZha2VzaWduYXR1cmVmYWtlc2lnbmF0dXJlZmFrZXNpZ25hdHVyZQ',
    };
    await fs.writeFile(policyPath, JSON.stringify(wrongKeyPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath, controlPlanePair)).rejects.toThrow(
      PolicySignatureError
    );
  });
});
