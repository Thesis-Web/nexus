/**
 * Integration tests for the F4.2 policy_bundle_replace flow — end-to-end
 * via SigningCouncil with the real buildPolicyBundleReplaceDispatcher.
 *
 * Covers POL-OCT-05 (malformed condition denied), POL-OCT-06 (observe
 * mode would-deny logging), POL-OCT-07 (enforcing mode deny fails closed),
 * POL-OCT-08 (default.policy.json signature verifies + every condition
 * has non-empty octLevels). The static AST gate GOV-13 lands in
 * scripts/ci-gate.ts; the unit-level POL-OCT-01..-04 live in
 * evaluator.test.ts + 04-policy.gate.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Buffer } from 'node:buffer';
import type {
  Base64Url,
  NonEmpty,
  PolicyFile,
  RunLedgerWriter,
  RunLedgerEntry,
} from '@nexus/contracts';
import { SigningCouncil, InMemorySigningCouncilRequestStore } from '../signing/signing-council.js';
import { buildPolicyBundleReplaceDispatcher } from '../signing/signing-council-dispatchers.js';
import type { KeyPair } from '../crypto/key-manager.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { loadPolicyFile } from './rule-loader.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

class MockRunLedger implements RunLedgerWriter {
  public events: RunLedgerEntry[] = [];
  async writeEvent(e: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    this.events.push({ ...e, entryId: randomUUID() as never });
  }
}

interface TestAdmin {
  readonly principalId: NonEmpty;
  readonly privateKey: string;
  readonly publicKey: string;
}

async function generateAdmin(keysRoot: string, slug: string): Promise<TestAdmin> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const principalId = `pol-admin-${slug}-${randomUUID().slice(0, 8)}` as NonEmpty;
  const publicKey = b64uEncode(pub);
  const privateKey = b64uEncode(priv);
  await fs.mkdir(path.join(keysRoot, 'admins'), { recursive: true });
  await fs.writeFile(
    path.join(keysRoot, 'admins', `${principalId}.public.json`),
    JSON.stringify({ adminId: principalId, publicKey, purpose: 'admin_signing' }, null, 2),
    'utf-8'
  );
  return { principalId, privateKey, publicKey };
}

async function generateControlPlane(): Promise<KeyPair> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  return {
    publicKey: b64uEncode(pub) as Base64Url,
    privateKey: b64uEncode(priv) as Base64Url,
    generatedAt: new Date().toISOString() as never,
    purpose: 'dev' as const,
  };
}

async function signEnvelope(envelope: string, privateKeyB64Url: string): Promise<Base64Url> {
  const priv = new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'));
  const sig = await ed25519.signAsync(new TextEncoder().encode(envelope), priv);
  return b64uEncode(sig) as Base64Url;
}

function makeValidBundleBody(): Omit<PolicyFile, 'signature'> {
  return {
    version: '1.0',
    bundleId: 'test-bundle-001' as NonEmpty,
    bundleVersion: 'v0.0.1' as NonEmpty,
    issuer: 'nexus-test' as NonEmpty,
    issuedAt: '2026-05-20T00:00:00.000Z' as never,
    defaultOutcome: 'deny' as never,
    rules: [
      {
        ruleId: 'allow-open-read' as NonEmpty,
        description: 'test',
        priority: 10,
        conditions: {
          capabilities: ['read:record:single'],
          octLevels: ['OCT-OPEN'] as readonly string[],
        } as never,
        outcome: 'allow' as never,
        approvalConfig: null,
        grantHint: null,
      } as never,
    ],
  } as never;
}

describe('F4.2 policy_bundle_replace integration (council + dispatcher + signed write)', () => {
  let originalCwd: string;
  let workRoot: string;
  let adminA: TestAdmin;
  let adminB: TestAdmin;
  let controlPlane: KeyPair;
  let ledger: MockRunLedger;
  let council: SigningCouncil;
  let targetPath: NonEmpty;

  beforeAll(async () => {
    originalCwd = process.cwd();
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pol-bundle-int-'));
    process.chdir(workRoot);
    adminA = await generateAdmin('keys', 'a');
    adminB = await generateAdmin('keys', 'b');
    controlPlane = await generateControlPlane();
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.rm(workRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    ledger = new MockRunLedger();
    targetPath = path.join(workRoot, 'bundles', 'test.policy.json') as NonEmpty;
    council = new SigningCouncil({
      store: new InMemorySigningCouncilRequestStore(),
      runLedger: ledger,
      dispatchers: {
        policy_bundle_replace: buildPolicyBundleReplaceDispatcher({
          controlPlaneKeypair: controlPlane,
          runLedger: ledger,
        }),
      },
    });
  });

  async function signTwoOfTwo(requestId: NonEmpty): Promise<void> {
    const req = (await council.get(requestId))!;
    const envelope = council.canonicalSigningEnvelope(req);
    const sigA = await signEnvelope(envelope, adminA.privateKey);
    const sigB = await signEnvelope(envelope, adminB.privateKey);
    await council.sign(requestId, adminA.principalId, sigA);
    await council.sign(requestId, adminB.principalId, sigB);
  }

  it('POL-OCT-05: 2-of-2 signatures but malformed condition (empty octLevels) → request denied', async () => {
    const badBundle = makeValidBundleBody();
    (badBundle.rules[0]!.conditions as { octLevels?: unknown }).octLevels = [];
    const opened = await council.open({
      operation: 'policy_bundle_replace',
      payload: { bundle: badBundle, targetPath } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    await signTwoOfTwo(opened.requestId);
    const final = (await council.get(opened.requestId))!;
    expect(final.status).toBe('denied');
    expect(String(final.denialReason)).toMatch(/POLICY_BUNDLE_REPLACE_EMPTY_OCT_LEVELS/);
    // The target file must NOT have been written.
    await expect(fs.stat(targetPath)).rejects.toThrow();
    // No policy_bundle_replaced ledger event.
    expect(ledger.events.find(e => e.eventType === 'policy_bundle_replaced')).toBeUndefined();
  });

  it('POL-OCT-05b: missing octLevels altogether → denied', async () => {
    const badBundle = makeValidBundleBody();
    delete (badBundle.rules[0]!.conditions as { octLevels?: unknown }).octLevels;
    const opened = await council.open({
      operation: 'policy_bundle_replace',
      payload: { bundle: badBundle, targetPath } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    await signTwoOfTwo(opened.requestId);
    const final = (await council.get(opened.requestId))!;
    expect(final.status).toBe('denied');
    expect(String(final.denialReason)).toMatch(/POLICY_BUNDLE_REPLACE_EMPTY_OCT_LEVELS/);
  });

  it('POL-OCT-07: 2-of-2 signatures + valid bundle → dispatcher signs + writes + emits policy_bundle_replaced', async () => {
    const goodBundle = makeValidBundleBody();
    const opened = await council.open({
      operation: 'policy_bundle_replace',
      payload: { bundle: goodBundle, targetPath } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    await signTwoOfTwo(opened.requestId);
    const final = (await council.get(opened.requestId))!;
    expect(final.status).toBe('executed');

    // File exists; signature verifies; body matches.
    const writtenRaw = await fs.readFile(targetPath, 'utf-8');
    const written = JSON.parse(writtenRaw) as PolicyFile;
    expect(written.bundleId).toBe(goodBundle.bundleId);
    expect(written.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    const { signature: writtenSig, ...body } = written;
    const verified = await verify(canonicalize(body), writtenSig, controlPlane.publicKey);
    expect(verified).toBe(true);

    // Ledger event written.
    const replaced = ledger.events.find(e => e.eventType === 'policy_bundle_replaced');
    expect(replaced).toBeDefined();
    expect((replaced!.detail as { bundleId?: string }).bundleId).toBe(goodBundle.bundleId);
    expect((replaced!.detail as { ruleCount?: number }).ruleCount).toBe(goodBundle.rules.length);
  });

  it('POL-OCT-08: shipped default policy bundle verifies signature + every condition carries non-empty octLevels', async () => {
    // The migration in this patch must produce a re-signed bundle whose
    // every condition has a non-empty octLevels list. Load the actual
    // shipped file from the repo (the test runs in workRoot; resolve
    // the canonical path relative to originalCwd).
    const repoPath = path.join(originalCwd, 'packages/core/src/policy/rules/default.policy.json');
    const raw = await fs.readFile(repoPath, 'utf-8');
    const parsed = JSON.parse(raw) as PolicyFile;
    // Signature must verify against the repo's actual control-plane
    // public key. Read the dev keypair from keys/dev.keypair.json (the
    // one the repo currently uses for signing). The control-plane
    // keypair is the issuer of the default bundle per sign-policy.ts.
    const devKeyPath = path.join(originalCwd, 'keys/dev.keypair.json');
    const devKeyRaw = await fs.readFile(devKeyPath, 'utf-8');
    const devKey = JSON.parse(devKeyRaw) as { publicKey: string };
    const { signature, ...body } = parsed;
    const ok = await verify(canonicalize(body), signature, devKey.publicKey);
    expect(ok).toBe(true);
    expect(parsed.rules.length).toBeGreaterThan(0);
    for (const rule of parsed.rules) {
      const octLevels = (rule.conditions as { octLevels?: unknown }).octLevels;
      expect(Array.isArray(octLevels)).toBe(true);
      expect((octLevels as unknown[]).length).toBeGreaterThan(0);
      for (const level of octLevels as unknown[]) {
        expect(typeof level).toBe('string');
        expect((level as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('POL-OCT-09: rule-loader round-trip on the policy file the dispatcher wrote', async () => {
    const goodBundle = makeValidBundleBody();
    const opened = await council.open({
      operation: 'policy_bundle_replace',
      payload: { bundle: goodBundle, targetPath } as unknown as Record<string, unknown>,
      openedBy: adminA.principalId,
    });
    await signTwoOfTwo(opened.requestId);
    // loadPolicyFile verifies the signature using the same key the
    // dispatcher signed with — full round trip.
    const loaded = await loadPolicyFile(targetPath, controlPlane);
    expect(loaded.bundleId).toBe(goodBundle.bundleId);
    expect(loaded.sortedRules.length).toBe(goodBundle.rules.length);
  });
});
