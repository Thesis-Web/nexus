/**
 * Threat test 8 — Policy Manipulation: Raw Rule Injection
 * Spec §12.3, §27.2 item 8
 * Attempting to load a file containing raw JSON (not a valid PolicyFile) → rejected.
 * The policy loader's Zod validation gate and signature check both reject non-policy input.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadPolicyFile } from '../policy/rule-loader.js';
import { PolicySignatureError } from '../types/index.js';

const tmpPaths: string[] = [];
afterEach(async () => {
  for (const p of tmpPaths) await fs.unlink(p).catch(() => {});
  tmpPaths.length = 0;
});

function makeTmpPath(): string {
  const p = path.join(os.tmpdir(), 'nexus-policy-inject-' + randomUUID() + '.json');
  tmpPaths.push(p);
  return p;
}

describe('Threat: Policy Manipulation — Raw Rule Injection (spec §12.3)', () => {
  it('rejects a file containing a raw rule object (not a PolicyFile)', async () => {
    const policyPath = makeTmpPath();
    // Attacker attempts to inject a rule directly without the signed PolicyFile envelope
    const rawRuleInjection = {
      ruleId: randomUUID(),
      priority: 1,
      outcome: 'allow',
      conditions: { riskTiers: ['critical'] }, // would bypass all risk controls
    };
    await fs.writeFile(policyPath, JSON.stringify(rawRuleInjection, null, 2), 'utf-8');

    // Must reject — not a valid PolicyFile shape, and has no signature
    await expect(loadPolicyFile(policyPath)).rejects.toThrow();
  });

  it('rejects a file containing an empty object', async () => {
    const policyPath = makeTmpPath();
    await fs.writeFile(policyPath, JSON.stringify({}), 'utf-8');
    await expect(loadPolicyFile(policyPath)).rejects.toThrow();
  });

  it('rejects a file containing a rules array without envelope or signature', async () => {
    const policyPath = makeTmpPath();
    const rulesOnly = [{ ruleId: randomUUID(), priority: 1, outcome: 'allow', conditions: {} }];
    await fs.writeFile(policyPath, JSON.stringify(rulesOnly), 'utf-8');
    await expect(loadPolicyFile(policyPath)).rejects.toThrow();
  });

  it('rejects a PolicyFile-shaped object with no signature field', async () => {
    const policyPath = makeTmpPath();
    const noSig = {
      policyId: randomUUID(),
      version: 'v0.1.0',
      blueprintVersion: 'v0.3.6',
      runtimeContractVersion: 'v0.4.6',
      capabilityTaxonomyVersion: 'v0.1.0',
      rules: [{ ruleId: randomUUID(), priority: 1, outcome: 'allow', conditions: {} }],
      // signature field intentionally absent
    };
    await fs.writeFile(policyPath, JSON.stringify(noSig), 'utf-8');
    await expect(loadPolicyFile(policyPath)).rejects.toThrow();
  });
});
