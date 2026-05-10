/**
 * Tests for the policy bundle loader + composer.
 *
 * Boot-time loading + signature verification + composition (P-pol-2).
 * Hot reload (Stage 2) and admin counter-signature (Stage 3) are
 * deferred — tracked in docs/STATUS-MULTI-NODE-PLANNER.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ed25519 from '@noble/ed25519';
import { sign, base64urlEncode } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';
import type { KeyPair } from '../crypto/key-manager.js';
import type { PolicyFile } from '../types/index.js';
import { loadPolicyBundleSet, composePolicyBundles } from './bundle-loader.js';
import { loadPolicyFile } from './rule-loader.js';

let tmpDir: string;
let key: KeyPair;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-policy-bundle-'));
  // In-memory keypair only — DO NOT call generateControlPlaneKeypair()
  // here; that helper writes to keys/dev.keypair.json on disk and
  // would overwrite the operator's actual control-plane key, breaking
  // every signed manifest in the repo.
  const privBytes = ed25519.utils.randomPrivateKey();
  const pubBytes = await ed25519.getPublicKeyAsync(privBytes);
  key = {
    publicKey: base64urlEncode(pubBytes),
    privateKey: base64urlEncode(privBytes),
    generatedAt: new Date().toISOString(),
    purpose: 'test',
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeSignedBundle(
  filename: string,
  body: Omit<PolicyFile, 'signature'>
): Promise<string> {
  const signature = await sign(canonicalize(body), key);
  const file: PolicyFile = { ...body, signature };
  const filepath = path.join(tmpDir, filename);
  await fs.writeFile(filepath, JSON.stringify(file, null, 2), 'utf-8');
  return filepath;
}

const MIN_DEFAULT: Omit<PolicyFile, 'signature'> = {
  version: '1.0',
  bundleId: '00000000-0000-0000-0000-000000000001' as never,
  bundleVersion: 'v0-test-default' as never,
  issuer: 'test',
  issuedAt: '2026-05-10T00:00:00.000Z' as never,
  defaultOutcome: 'deny',
  rules: [
    {
      ruleId: 'allow-low-read-default' as never,
      priority: 10,
      conditions: { actorClasses: ['SUPERVISED_AGENT'], capabilities: ['read:record:single'] },
      outcome: 'allow',
    },
  ],
};

const EXTRA_BUNDLE: Omit<PolicyFile, 'signature'> = {
  version: '1.0',
  bundleId: '00000000-0000-0000-0000-000000000002' as never,
  bundleVersion: 'v0-test-extra' as never,
  issuer: 'test',
  issuedAt: '2026-05-10T00:00:01.000Z' as never,
  defaultOutcome: 'deny',
  rules: [
    {
      ruleId: 'allow-bulk-read-warehouse' as never,
      priority: 12,
      conditions: {
        actorClasses: ['SUPERVISED_AGENT'],
        capabilities: ['read:record:bulk'],
        targetSystems: ['warehouse'],
      },
      outcome: 'allow',
    },
  ],
};

describe('loadPolicyBundleSet', () => {
  it('loads just the default when no additional dir is provided', async () => {
    const defaultPath = await writeSignedBundle('default.policy.json', MIN_DEFAULT);
    const set = await loadPolicyBundleSet({ defaultBundlePath: defaultPath, key });
    expect(set.bundles).toHaveLength(1);
    expect(set.composed.sortedRules).toHaveLength(1);
    expect(set.composed.sortedRules[0]!.ruleId).toBe('allow-low-read-default');
    expect(set.composed.sortedRules[0]!.bundleRef!.bundleId).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
  });

  it('loads default + bundles from additional directory in alphabetical order', async () => {
    const defaultPath = await writeSignedBundle('default.policy.json', MIN_DEFAULT);
    const extraDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-extra-'));
    try {
      const extraSpec = { ...EXTRA_BUNDLE };
      const extraSig = await sign(canonicalize(extraSpec), key);
      await fs.writeFile(
        path.join(extraDir, 'b-warehouse.policy.json'),
        JSON.stringify({ ...extraSpec, signature: extraSig }, null, 2)
      );
      const set = await loadPolicyBundleSet({
        defaultBundlePath: defaultPath,
        additionalBundlesDir: extraDir,
        key,
      });
      expect(set.bundles).toHaveLength(2);
      expect(set.composed.sortedRules).toHaveLength(2);
      // Sorted by priority: default's rule (10) before extra's rule (12)
      expect(set.composed.sortedRules[0]!.ruleId).toBe('allow-low-read-default');
      expect(set.composed.sortedRules[1]!.ruleId).toBe('allow-bulk-read-warehouse');
    } finally {
      await fs.rm(extraDir, { recursive: true, force: true });
    }
  });

  it('skips files that do not end with .policy.json', async () => {
    const defaultPath = await writeSignedBundle('default.policy.json', MIN_DEFAULT);
    const extraDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-extra-'));
    try {
      // Drop a non-policy file alongside.
      await fs.writeFile(path.join(extraDir, 'README.md'), '# notes');
      await fs.writeFile(path.join(extraDir, 'broken.json'), '{}'); // not .policy.json
      const set = await loadPolicyBundleSet({
        defaultBundlePath: defaultPath,
        additionalBundlesDir: extraDir,
        key,
      });
      expect(set.bundles).toHaveLength(1); // only the default
    } finally {
      await fs.rm(extraDir, { recursive: true, force: true });
    }
  });

  it('returns empty additional set when the directory does not exist (back-compat)', async () => {
    const defaultPath = await writeSignedBundle('default.policy.json', MIN_DEFAULT);
    const set = await loadPolicyBundleSet({
      defaultBundlePath: defaultPath,
      additionalBundlesDir: '/no/such/path/here',
      key,
    });
    expect(set.bundles).toHaveLength(1);
  });

  it('throws PolicySignatureError when any bundle is tampered with', async () => {
    const defaultPath = await writeSignedBundle('default.policy.json', MIN_DEFAULT);
    const extraDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-extra-'));
    try {
      // Hand-write a bundle with a bogus signature.
      await fs.writeFile(
        path.join(extraDir, 'bad.policy.json'),
        JSON.stringify({ ...EXTRA_BUNDLE, signature: 'this-is-not-a-real-signature' }, null, 2)
      );
      await expect(
        loadPolicyBundleSet({
          defaultBundlePath: defaultPath,
          additionalBundlesDir: extraDir,
          key,
        })
      ).rejects.toThrow(/signature/);
    } finally {
      await fs.rm(extraDir, { recursive: true, force: true });
    }
  });
});

describe('composePolicyBundles', () => {
  it('disambiguates colliding ruleIds with bundleId prefix', async () => {
    // Two bundles, both with a rule named 'shared-id' but different conditions.
    const a = await writeSignedBundle('a.policy.json', {
      ...MIN_DEFAULT,
      bundleId: '00000000-0000-0000-0000-aaaaaaaaaaaa' as never,
      rules: [
        {
          ruleId: 'shared-id' as never,
          priority: 5,
          conditions: { actorClasses: ['SUPERVISED_AGENT'] },
          outcome: 'allow',
        },
      ],
    });
    const b = await writeSignedBundle('b.policy.json', {
      ...EXTRA_BUNDLE,
      bundleId: '00000000-0000-0000-0000-bbbbbbbbbbbb' as never,
      rules: [
        {
          ruleId: 'shared-id' as never,
          priority: 6,
          conditions: { actorClasses: ['HUMAN'] },
          outcome: 'allow',
        },
      ],
    });
    const aLoaded = await loadPolicyFile(a, key);
    const bLoaded = await loadPolicyFile(b, key);
    const composed = composePolicyBundles([aLoaded, bLoaded]);
    expect(composed.sortedRules).toHaveLength(2);
    expect(composed.sortedRules[0]!.ruleId).toBe('shared-id'); // first wins, keeps id
    expect(composed.sortedRules[1]!.ruleId).toMatch(/::shared-id$/); // second prefixed
    // Both rules carry their bundleRef so audit is preserved.
    expect(composed.sortedRules[0]!.bundleRef!.bundleId).toBe(
      '00000000-0000-0000-0000-aaaaaaaaaaaa'
    );
    expect(composed.sortedRules[1]!.bundleRef!.bundleId).toBe(
      '00000000-0000-0000-0000-bbbbbbbbbbbb'
    );
  });

  it('sorts by priority across all source bundles', async () => {
    const a = await writeSignedBundle('a.policy.json', {
      ...MIN_DEFAULT,
      rules: [
        {
          ruleId: 'rule-pri-30' as never,
          priority: 30,
          conditions: {},
          outcome: 'allow',
        },
        {
          ruleId: 'rule-pri-10' as never,
          priority: 10,
          conditions: {},
          outcome: 'allow',
        },
      ],
    });
    const b = await writeSignedBundle('b.policy.json', {
      ...EXTRA_BUNDLE,
      rules: [
        {
          ruleId: 'rule-pri-20' as never,
          priority: 20,
          conditions: {},
          outcome: 'allow',
        },
      ],
    });
    const composed = composePolicyBundles([
      await loadPolicyFile(a, key),
      await loadPolicyFile(b, key),
    ]);
    expect(composed.sortedRules.map(r => r.ruleId)).toEqual([
      'rule-pri-10',
      'rule-pri-20',
      'rule-pri-30',
    ]);
  });

  it('throws when called with empty bundles list (defensive)', () => {
    expect(() => composePolicyBundles([])).toThrow();
  });

  it('produces a stable composed bundleHash for the same inputs', async () => {
    const a = await writeSignedBundle('a.policy.json', MIN_DEFAULT);
    const a2 = await writeSignedBundle('a2.policy.json', MIN_DEFAULT); // same content, different file
    const composedA = composePolicyBundles([await loadPolicyFile(a, key)]);
    const composedA2 = composePolicyBundles([await loadPolicyFile(a2, key)]);
    expect(composedA.bundleHash).toBe(composedA2.bundleHash);
  });
});
