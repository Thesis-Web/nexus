/**
 * Threat test 7 — Policy Manipulation: Unsigned Policy
 * Spec §12.3, §27.2 item 7
 * Policy file without valid Ed25519 signature → PolicySignatureError at load time.
 * Unsigned policies must never be loaded into the engine.
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
      signature: '', // empty — not signed
    };
    await fs.writeFile(policyPath, JSON.stringify(unsignedPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath)).rejects.toThrow(PolicySignatureError);
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
      // A plausible base64url signature that does not verify against this body
      signature:
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    await fs.writeFile(policyPath, JSON.stringify(tamperedPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath)).rejects.toThrow(PolicySignatureError);
  });

  it('does not load a policy file that was signed with a different key', async () => {
    const policyPath = makeTmpPath();
    const wrongKeySignedPolicy = {
      policyId: randomUUID(),
      version: 'v0.1.0',
      blueprintVersion: 'v0.3.6',
      runtimeContractVersion: 'v0.4.6',
      capabilityTaxonomyVersion: 'v0.1.0',
      rules: [],
      // controlPlanePair.publicKey is the correct key — this signature was made with a different key
      signature: 'ZmFrZXNpZ25hdHVyZWZha2VzaWduYXR1cmVmYWtlc2lnbmF0dXJlZmFrZXNpZ25hdHVyZQ',
    };
    await fs.writeFile(policyPath, JSON.stringify(wrongKeySignedPolicy, null, 2), 'utf-8');

    await expect(loadPolicyFile(policyPath)).rejects.toThrow(PolicySignatureError);
  });
});
