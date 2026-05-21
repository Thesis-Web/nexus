/**
 * tests/e2e/00-phase-0-acceptance-spine.e2e.test.ts
 *
 * Phase 0 — the acceptance spine. Twelve tests that prove the runnable
 * MVP never drifts: docker target systems healthy, Nexus serve starts,
 * health responds, workspace login + elevation, admin catalog reads,
 * signed admin write through the F4.13 middleware, readback,
 * RunLedger audit pair (intent + committed), nonce-replay rejection,
 * elevation-required rejection, and a fixture that proves the
 * GOV-AUTHORITY-STRICTNESS-GATE catches wildcard authority.
 *
 * These tests are intentionally ordered earlier than the v0.4.0 wall
 * (categories 1-12) and reuse the same `tests/e2e/harness.ts` boot
 * path so a single failure here flags a foundation regression before
 * any wall test runs.
 *
 * If anything here fails:
 *   E2E-000 → docker compose / port collision / target-system container
 *   E2E-001 → bootHarness() / nexus-bootstrap composition root crash
 *   E2E-002 → /health route or registerAllRoutes wiring
 *   E2E-003 → workspace JWT secret / api-key seeding / identityProvider
 *   E2E-004 → ReferenceElevatedAuthProvider / ElevatedCredentialVerifier
 *   E2E-005 → /workspace/admin/setup/catalog route or claims projection
 *   E2E-006 → withAdminMutation composition (Patch 40 ports)
 *   E2E-007 → ActorRegistry write/read or catalog projection
 *   E2E-008 → InfraRunIdNamespace / runLedgerWriter audit event writes
 *   E2E-009 → InMemoryAdminMutationNonceStore replay rejection
 *   E2E-010 → checkAdminAuth elevated-session gate
 *   E2E-011 → GOV-AUTHORITY-STRICTNESS-GATE scanner regression
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import { createConnection } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '../../packages/runtime-utils/src/canonicalize.js';
import { runScan } from '../../scripts/gates/no-wildcard-authority.js';
import { bootHarness, type E2EHarness } from './harness.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

const DEV_ADMIN_PRINCIPAL = '00000000-0000-4000-a000-000000000001';

interface JsonResponse {
  status: number;
  body: unknown;
}

async function http(
  baseUrl: string,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${url}`, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function unwrapData<T>(r: JsonResponse): T {
  return (r.body as { data?: T }).data as T;
}

async function tcpPortOpen(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ host, port });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

async function ed25519SignB64u(canonicalBody: string, privateKeyB64u: string): Promise<string> {
  const msg = new TextEncoder().encode(canonicalBody);
  const priv = new Uint8Array(Buffer.from(privateKeyB64u, 'base64url'));
  const sig = await ed25519.signAsync(msg, priv);
  return Buffer.from(sig).toString('base64url');
}

function makeNonce(seed: string): string {
  const h = createHash('sha256');
  h.update(seed);
  h.update(String(Date.now()));
  h.update(String(Math.random()));
  return h.digest('base64url').slice(0, 32);
}

interface LedgerEvent {
  runId?: string;
  eventType?: string;
  detail?: Record<string, unknown>;
}

async function readInfraLedger(tmpCwd: string): Promise<LedgerEvent[]> {
  const p = path.join(tmpCwd, 'runs', 'infra.run-ledger.jsonl');
  let raw = '';
  try {
    raw = await fs.readFile(p, 'utf-8');
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as LedgerEvent;
      } catch {
        return {};
      }
    });
}

// ── Test suite ────────────────────────────────────────────────────────────

describe('E2E Phase 0 — acceptance spine', () => {
  // ── Infrastructure preconditions (no server needed) ──────────────────
  describe('infrastructure preconditions', () => {
    it('E2E-000 docker target systems healthy', async () => {
      // The two Postgres target systems are mapped to 127.0.0.1:5433
      // (nexus-sales-finance) and 127.0.0.1:5434 (nexus-warehouse). A
      // TCP connect succeeds when the container is up + the healthcheck
      // is green; we deliberately do NOT shell out to `docker` so the
      // test passes on hosts where the docker CLI lives in a different
      // distro than the test runner (Docker Desktop / WSL split).
      const sales = await tcpPortOpen('127.0.0.1', 5433);
      const warehouse = await tcpPortOpen('127.0.0.1', 5434);
      expect(sales, 'nexus-sales-finance on 127.0.0.1:5433').toBe(true);
      expect(warehouse, 'nexus-warehouse on 127.0.0.1:5434').toBe(true);
    });
  });

  // ── Server lifecycle + auth + admin write (one shared harness) ───────
  describe('server lifecycle + auth + admin write', () => {
    let harness: E2EHarness;
    let jwt: string;
    let elevatedSessionId: string;
    let createdActorId: string;
    let lastMutationId: string | undefined;
    let signedEnvelopeForReplay: Record<string, unknown> | undefined;
    let signedEnvelopeReplayCommittedMutationId: string | undefined;

    beforeAll(async () => {
      harness = await bootHarness();
    }, 120_000);

    afterAll(async () => {
      if (harness) await harness.shutdown();
    });

    it('E2E-001 Nexus serve starts', () => {
      // bootHarness throws on startup failure / health timeout, so
      // reaching this assertion means serve started + /health was
      // healthy at least once. The baseUrl shape is verified here as a
      // sanity check that the harness chose a free port.
      expect(harness.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('E2E-002 /health returns healthy', async () => {
      const res = await http(harness.baseUrl, 'GET', '/health');
      expect(res.status).toBe(200);
      const body = res.body as { ok?: boolean; status?: string };
      expect(body.ok).toBe(true);
      expect(body.status).toBe('healthy');
    });

    it('E2E-003 workspace dev-admin login succeeds', async () => {
      jwt = await harness.jwtFor('dev-admin');
      expect(typeof jwt).toBe('string');
      expect(jwt.split('.')).toHaveLength(3); // JWT shape

      // /workspace/me must round-trip with the JWT and carry the
      // nexus-admin role (proves identity claims projection works).
      const me = await http(harness.baseUrl, 'GET', '/workspace/me', undefined, {
        Authorization: `Bearer ${jwt}`,
      });
      expect(me.status).toBe(200);
      const claims = (me.body as { data?: { claims?: { roleAssignments?: string[] } } }).data
        ?.claims;
      expect(claims?.roleAssignments).toContain('nexus-admin');
    });

    it('E2E-004 elevated admin session opens', async () => {
      // Production-correct elevation (Patch 41): the response must equal
      // the principal's registered api key. The harness uses the real
      // dev-admin api key so this should succeed; the credential
      // verifier returning true is what proves the path is wired.
      elevatedSessionId = await harness.elevatedSessionFor('dev-admin', jwt);
      expect(elevatedSessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('E2E-005 admin setup catalog loads', async () => {
      const cat = await http(harness.baseUrl, 'GET', '/workspace/admin/setup/catalog', undefined, {
        Authorization: `Bearer ${jwt}`,
        'X-Elevated-Session': elevatedSessionId,
      });
      expect(cat.status).toBe(200);
      const data = unwrapData<{ allActors?: unknown[]; allConnectors?: unknown[] }>(cat);
      expect(Array.isArray(data.allActors)).toBe(true);
      expect((data.allActors as unknown[]).length).toBeGreaterThan(0);
      expect(Array.isArray(data.allConnectors)).toBe(true);
    });

    it('E2E-006 signed admin setup write succeeds', async () => {
      // UI-shape POST → the F4.13 middleware loads the dev-admin
      // keypair, signs the canonical envelope server-side, verifies,
      // claims a nonce, writes admin_mutation_intent, then applies
      // the registry mutation, then writes admin_mutation_committed.
      // Any composition gap (signer/verifier/nonce/ledger/infra-runid
      // missing) would fail closed at this step with 503.
      createdActorId = randomUUID();
      const payload = {
        actorId: createdActorId,
        actorClass: 'SUPERVISED_AGENT',
        displayName: 'phase-0-spine-probe',
        principalId: DEV_ADMIN_PRINCIPAL,
        environment: 'reference',
        riskCeiling: 'low',
        octLevel: 'OCT-OPEN',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single'],
        owner: 'tests/e2e/00-phase-0-acceptance-spine',
        purpose: 'Phase 0 acceptance spine probe',
        reviewCadence: 'quarterly',
      };
      const res = await http(harness.baseUrl, 'POST', '/workspace/admin/setup/actors', payload, {
        Authorization: `Bearer ${jwt}`,
        'X-Elevated-Session': elevatedSessionId,
      });
      expect(res.status).toBe(200);
      const data = unwrapData<{ mutationId?: string; mutationKind?: string }>(res);
      expect(data.mutationKind).toBe('actor_register');
      expect(typeof data.mutationId).toBe('string');
      lastMutationId = data.mutationId;
    });

    it('E2E-007 admin write readback succeeds', async () => {
      const cat = await http(harness.baseUrl, 'GET', '/workspace/admin/setup/catalog', undefined, {
        Authorization: `Bearer ${jwt}`,
        'X-Elevated-Session': elevatedSessionId,
      });
      expect(cat.status).toBe(200);
      const actors = unwrapData<{ allActors?: Array<{ actorId: string }> }>(cat).allActors ?? [];
      expect(actors.some(a => a.actorId === createdActorId)).toBe(true);
    });

    it('E2E-008 admin mutation audit event exists in Run Ledger', async () => {
      const events = await readInfraLedger(harness.cwd);
      const intent = events.find(
        e =>
          e.eventType === 'admin_mutation_intent' &&
          e.detail?.['mutationId'] === lastMutationId &&
          e.detail?.['mutationKind'] === 'actor_register' &&
          typeof e.detail?.['payloadDigest'] === 'string' &&
          typeof e.detail?.['signatureRef'] === 'string'
      );
      const commit = events.find(
        e =>
          e.eventType === 'admin_mutation_committed' &&
          e.detail?.['mutationId'] === lastMutationId &&
          e.detail?.['mutationKind'] === 'actor_register'
      );
      expect(intent, `admin_mutation_intent for ${lastMutationId}`).toBeDefined();
      expect(commit, `admin_mutation_committed for ${lastMutationId}`).toBeDefined();
    });

    it('E2E-009 replayed admin mutation nonce/signature fails', async () => {
      // Build a fresh CLI-shape envelope (the test signs it directly so
      // we can replay the exact same nonce). First POST applies, second
      // POST must return 409 ADMIN_MUTATION_NONCE_REPLAY.
      const repoRoot = process.cwd();
      const kpRaw = await fs.readFile(
        path.join(repoRoot, 'keys', 'admins', `${DEV_ADMIN_PRINCIPAL}.keypair.json`),
        'utf-8'
      );
      const kp = JSON.parse(kpRaw) as { publicKey: string; privateKey: string };
      const nonce = makeNonce('phase-0-replay');
      const issuedAt = new Date().toISOString();
      const payload = {
        actorId: randomUUID(),
        actorClass: 'SUPERVISED_AGENT',
        displayName: 'phase-0-replay-probe',
        principalId: DEV_ADMIN_PRINCIPAL,
        environment: 'reference',
        riskCeiling: 'low',
        octLevel: 'OCT-OPEN',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single'],
        owner: 'tests/e2e/00-phase-0-acceptance-spine',
        purpose: 'Phase 0 replay probe',
        reviewCadence: 'quarterly',
      };
      const canonicalBody = canonicalize({
        mutationKind: 'actor_register',
        payload,
        opener: DEV_ADMIN_PRINCIPAL,
        issuedAt,
        nonce,
      });
      const signature = await ed25519SignB64u(canonicalBody, kp.privateKey);
      const envelope = {
        mutationKind: 'actor_register',
        payload,
        opener: DEV_ADMIN_PRINCIPAL,
        issuedAt,
        nonce,
        signature,
      };
      signedEnvelopeForReplay = envelope;

      const first = await http(harness.baseUrl, 'POST', '/workspace/admin/setup/actors', envelope, {
        Authorization: `Bearer ${jwt}`,
        'X-Elevated-Session': elevatedSessionId,
      });
      expect(first.status).toBe(200);
      signedEnvelopeReplayCommittedMutationId = (first.body as { data?: { mutationId?: string } })
        .data?.mutationId;

      const second = await http(
        harness.baseUrl,
        'POST',
        '/workspace/admin/setup/actors',
        envelope,
        {
          Authorization: `Bearer ${jwt}`,
          'X-Elevated-Session': elevatedSessionId,
        }
      );
      expect(second.status).toBe(409);
      const body = second.body as { ok?: boolean; denialCode?: string };
      expect(body.ok).toBe(false);
      expect(body.denialCode).toBe('admin_mutation_nonce_replay');
    });

    it('E2E-010 invalid/missing elevated session fails', async () => {
      // Same write path as E2E-006 but without the X-Elevated-Session
      // header. The admin-auth gate fails closed with 401/403 before
      // any signing/audit work happens.
      const payload = {
        actorId: randomUUID(),
        actorClass: 'SUPERVISED_AGENT',
        displayName: 'phase-0-no-elev-probe',
        principalId: DEV_ADMIN_PRINCIPAL,
        environment: 'reference',
        riskCeiling: 'low',
        octLevel: 'OCT-OPEN',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single'],
        owner: 'tests/e2e/00-phase-0-acceptance-spine',
        purpose: 'Phase 0 no-elevation probe',
        reviewCadence: 'quarterly',
      };
      const noElev = await http(harness.baseUrl, 'POST', '/workspace/admin/setup/actors', payload, {
        Authorization: `Bearer ${jwt}`,
        // intentionally no X-Elevated-Session header
      });
      expect([401, 403]).toContain(noElev.status);

      // Also confirm a bogus session id is rejected.
      const bogus = await http(harness.baseUrl, 'POST', '/workspace/admin/setup/actors', payload, {
        Authorization: `Bearer ${jwt}`,
        'X-Elevated-Session': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      });
      expect([401, 403]).toContain(bogus.status);

      // Self-suppress the unused-state hint for replay state vars;
      // they are kept across `it` blocks intentionally.
      void signedEnvelopeForReplay;
      void signedEnvelopeReplayCommittedMutationId;
    });
  });

  // ── CI gate fixture (no server needed) ───────────────────────────────
  describe('CI gate fixture', () => {
    it('E2E-011 wildcard authority fixture fails CI gate', async () => {
      // Build a fresh tmp "repo" with one file under a scanned path
      // (packages/<x>/src/*.ts) that contains a literal wildcard
      // authority. The runScan API is exactly what scripts/ci-gate.ts
      // step 4 (GOV-AUTHORITY-STRICTNESS-GATE) invokes; asserting it
      // catches this fixture protects the gate from silent regression.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'phase0-gate-fixture-'));
      try {
        const fixturePath = 'packages/__phase0_gate_fixture__/src/seed.ts';
        const abs = path.join(tmp, fixturePath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        // String-concat the wildcard so THIS test file does not match
        // the scanner's TS_WILDCARD_PATTERN itself.
        const W = "'" + '*' + "'";
        const offending = `export const cfg = { allowedSystems: [${W}] };\n`;
        await fs.writeFile(abs, offending, 'utf-8');

        const result = await runScan({
          repoRoot: tmp,
          scanPaths: [fixturePath],
          allowlist: { entries: [] },
        });

        expect(result.violations.length).toBeGreaterThan(0);
        expect(result.violations.some(v => v.ruleId === 'GOV-WILD-001')).toBe(true);
        const v = result.violations.find(v => v.ruleId === 'GOV-WILD-001');
        expect(v?.filePath).toBe(fixturePath);
        expect(v?.detail).toMatch(/literal wildcard authority/);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });
});
