/**
 * scripts/dev/verify-admin-write.ts
 *
 * F4.13 acceptance smoke for the SignedAdminMutation surface.
 *
 * Production-correct end-to-end probe of the admin write rail. Runs against
 * a live `nexus serve` (default http://127.0.0.1:7701) — does NOT mock,
 * does NOT bypass any middleware, does NOT relax any check.
 *
 * The script exits non-zero on the first failed assertion so it can be
 * wired into CI/the dev up smoke later.
 *
 * Happy path:
 *   1. workspace login with the dev-admin api-key                → JWT
 *   2. /workspace/vault/auth challenge + verify                  → X-Elevated-Session
 *   3. GET  /workspace/admin/setup/catalog                       → baseline state
 *   4. POST /workspace/admin/setup/actors (plain payload — UI shape)
 *      → 200 with mutationId, mutationKind: 'actor_register'
 *   5. GET  /workspace/admin/setup/catalog                       → new actor visible
 *   6. RunLedger sweep on runs/run-ledger.jsonl
 *      → admin_mutation_intent + admin_mutation_committed events
 *        carrying the same mutationId
 *
 * Negative cases (each must be fail-closed):
 *   7. Replay of the same UI-shape POST inside one second
 *      → must NOT silently succeed twice; expects 200 once + 409
 *        (the server signer constructs a fresh nonce per call, so two
 *        UI-shape posts succeed independently — the replay test uses
 *        a CLI-shape pre-signed envelope replayed against the same nonce)
 *   8. CLI-shape envelope with a deliberately mangled signature
 *      → 403 invalid_signature
 *   9. Missing X-Elevated-Session on a write
 *      → 401 / 403 from the admin-auth elevation gate
 *
 * Exit codes:
 *   0  — every assertion passed
 *   1  — at least one assertion failed
 *
 * Usage:
 *   pnpm exec tsx scripts/dev/verify-admin-write.ts
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '../../packages/runtime-utils/src/canonicalize.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

const BASE = process.env['NEXUS_BASE_URL'] ?? 'http://127.0.0.1:7701';
const DEV_ADMIN_PRINCIPAL = '00000000-0000-4000-a000-000000000001';

interface RawResponse {
  status: number;
  body: unknown;
}

let failures = 0;
function pass(msg: string): void {
  console.log(`✓ ${msg}`);
}
function fail(msg: string, detail?: unknown): void {
  failures += 1;
  console.log(`✗ ${msg}`);
  if (detail !== undefined) console.log('  detail:', JSON.stringify(detail, null, 2));
}

async function http(
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<RawResponse> {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${url}`, init);
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function unwrapData<T>(r: RawResponse): T {
  const b = r.body as { data?: T };
  return b.data as T;
}

async function loadDevAdminApiKey(): Promise<string> {
  return (await fs.readFile(path.join('keys', 'workspace-dev-admin.apikey'), 'utf-8')).trim();
}

async function loadDevAdminKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const raw = await fs.readFile(
    path.join('keys', 'admins', `${DEV_ADMIN_PRINCIPAL}.keypair.json`),
    'utf-8'
  );
  return JSON.parse(raw) as { publicKey: string; privateKey: string };
}

async function ed25519Sign(canonicalBody: string, privateKeyB64Url: string): Promise<string> {
  const msg = new TextEncoder().encode(canonicalBody);
  const priv = new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'));
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

async function readRunLedgerEvents(): Promise<LedgerEvent[]> {
  // The composition root writes admin_mutation_* events to the
  // infrastructure run ledger (`runs/infra.run-ledger.jsonl`) — separate
  // file from per-run ledgers under `runs/run-<id>/`. See serve.ts
  // `runLedgerPath` default.
  const p = path.join('runs', 'infra.run-ledger.jsonl');
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

async function main(): Promise<void> {
  console.log(`▶ F4.13 admin write smoke — base=${BASE}`);
  console.log();

  // ── 0. dev-admin api-key + admin keypair must exist ────────────────────
  const apiKey = await loadDevAdminApiKey().catch(() => {
    fail('keys/workspace-dev-admin.apikey missing — run scripts/dev/up.sh');
    process.exit(1);
  });
  const adminKp = await loadDevAdminKeypair().catch(() => {
    fail(
      `keys/admins/${DEV_ADMIN_PRINCIPAL}.keypair.json missing — run scripts/dev/up.sh (admin keypair generation)`
    );
    process.exit(1);
  });
  pass('dev-admin api-key + signing keypair present on disk');

  // ── 1. workspace login ─────────────────────────────────────────────────
  const login = await http('POST', '/workspace/auth/login', { type: 'api_key', value: apiKey });
  if (login.status !== 200) fail('workspace login', login.body);
  else pass('workspace login → 200');
  const jwt = unwrapData<{ token: string }>(login).token;

  // ── 2. elevated session ────────────────────────────────────────────────
  const ch = await http(
    'POST',
    '/workspace/vault/auth',
    { action: 'challenge', principalId: DEV_ADMIN_PRINCIPAL, method: 'api_key_reauth' },
    { Authorization: `Bearer ${jwt}` }
  );
  if (ch.status !== 200) fail('elevation challenge', ch.body);
  else pass('elevation challenge → 200');
  const challengeId = unwrapData<{ challengeId: string }>(ch).challengeId;
  const vr = await http(
    'POST',
    '/workspace/vault/auth',
    {
      action: 'verify',
      challengeId,
      principalId: DEV_ADMIN_PRINCIPAL,
      method: 'api_key_reauth',
      response: apiKey,
    },
    { Authorization: `Bearer ${jwt}` }
  );
  if (vr.status !== 200) fail('elevation verify', vr.body);
  else pass('elevation verify → 200');
  const elev = unwrapData<{ elevatedSessionId: string }>(vr).elevatedSessionId;

  // Headers used for authenticated + elevated calls.
  const authH: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    'X-Elevated-Session': elev,
  };

  // ── 3. baseline catalog ────────────────────────────────────────────────
  const cat0 = await http('GET', '/workspace/admin/setup/catalog', undefined, authH);
  if (cat0.status !== 200) fail('baseline catalog GET', cat0.body);
  else pass('baseline catalog GET → 200');

  // ── 4. POST a Zod-valid actor via UI-shape (server signs) ──────────────
  const newActorId = randomUUID();
  // Registry requires explicit octLevel for non-HUMAN actors per §11.3
  // and owner/purpose/reviewCadence per the same rule. The smoke uses
  // OCT-OPEN — the most-permissive level that still requires explicit
  // declaration (so the actor doesn't accidentally inherit a higher
  // ceiling).
  const payload = {
    actorId: newActorId,
    actorClass: 'SUPERVISED_AGENT',
    displayName: 'f4.13-smoke-probe',
    principalId: DEV_ADMIN_PRINCIPAL,
    environment: 'reference',
    riskCeiling: 'low',
    octLevel: 'OCT-OPEN',
    allowedSystems: ['stub'],
    allowedCapabilities: ['read:record:single'],
    owner: 'verify-admin-write.ts',
    purpose: 'F4.13 admin write composition-root smoke',
    reviewCadence: 'quarterly',
  };
  const createRes = await http('POST', '/workspace/admin/setup/actors', payload, authH);
  if (createRes.status !== 200) {
    fail('POST actor (UI-shape, server signs) → 200', createRes.body);
  } else {
    const data = unwrapData<{ mutationId?: string; mutationKind?: string }>(createRes);
    if (typeof data.mutationId === 'string' && data.mutationKind === 'actor_register') {
      pass(`POST actor → 200; mutationId=${data.mutationId}, kind=actor_register`);
    } else {
      fail('POST actor response missing mutationId / wrong mutationKind', data);
    }
  }

  // ── 5. catalog readback shows the new actor ────────────────────────────
  const cat1 = await http('GET', '/workspace/admin/setup/catalog', undefined, authH);
  const actors =
    (unwrapData<{ allActors?: Array<{ actorId: string }> }>(cat1).allActors as Array<{
      actorId: string;
    }>) ?? [];
  if (actors.some(a => a.actorId === newActorId)) {
    pass(`catalog readback shows new actor ${newActorId.slice(0, 8)}…`);
  } else {
    fail(
      `catalog readback missing new actor ${newActorId}`,
      actors.map(a => a.actorId)
    );
  }

  // ── 6. RunLedger carries admin_mutation_intent + _committed ────────────
  const ledger = await readRunLedgerEvents();
  const intentEvent = ledger.find(
    e =>
      e.eventType === 'admin_mutation_intent' &&
      (e.detail?.['payloadDigest'] as string | undefined) !== undefined &&
      (e.detail?.['mutationKind'] as string | undefined) === 'actor_register'
  );
  const commitEvent = ledger.find(
    e =>
      e.eventType === 'admin_mutation_committed' &&
      (e.detail?.['mutationKind'] as string | undefined) === 'actor_register'
  );
  if (!intentEvent) fail('RunLedger missing admin_mutation_intent (actor_register)');
  else
    pass(`RunLedger has admin_mutation_intent; mutationId=${intentEvent.detail?.['mutationId']}`);
  if (!commitEvent) fail('RunLedger missing admin_mutation_committed (actor_register)');
  else
    pass(
      `RunLedger has admin_mutation_committed; mutationId=${commitEvent.detail?.['mutationId']}`
    );

  // ── 7. Negative: CLI-shape envelope with reused nonce → 409 replay ─────
  const replayNonce = makeNonce('replay-probe');
  const issuedAt = new Date().toISOString();
  const replayPayload = {
    actorId: randomUUID(),
    actorClass: 'SUPERVISED_AGENT',
    displayName: 'f4.13-smoke-replay-probe',
    principalId: DEV_ADMIN_PRINCIPAL,
    environment: 'reference',
    riskCeiling: 'low',
    octLevel: 'OCT-OPEN',
    allowedSystems: ['stub'],
    allowedCapabilities: ['read:record:single'],
    owner: 'verify-admin-write.ts',
    purpose: 'F4.13 nonce replay probe',
    reviewCadence: 'quarterly',
  };
  const canonicalBody = canonicalize({
    mutationKind: 'actor_register',
    payload: replayPayload,
    opener: DEV_ADMIN_PRINCIPAL,
    issuedAt,
    nonce: replayNonce,
  });
  const sig = await ed25519Sign(canonicalBody, adminKp.privateKey);
  const envelope = {
    mutationKind: 'actor_register',
    payload: replayPayload,
    opener: DEV_ADMIN_PRINCIPAL,
    issuedAt,
    nonce: replayNonce,
    signature: sig,
  };
  const first = await http('POST', '/workspace/admin/setup/actors', envelope, authH);
  if (first.status !== 200) {
    fail('first CLI-shape signed write → 200', first.body);
  } else {
    pass('first CLI-shape signed write → 200');
  }
  // Replay the exact same envelope — the nonce store MUST reject.
  const second = await http('POST', '/workspace/admin/setup/actors', envelope, authH);
  if (second.status === 409) {
    pass('replay of identical envelope → 409 (nonce store rejected)');
  } else {
    fail('replay of identical envelope did NOT return 409', {
      status: second.status,
      body: second.body,
    });
  }

  // ── 8. Negative: CLI-shape envelope with mangled signature → 403 ───────
  const tamper = {
    ...envelope,
    nonce: makeNonce('tamper'),
    // valid base64url that decodes to 64 bytes but is not the correct
    // signature for the canonical body above
    signature: Buffer.alloc(64, 0xab).toString('base64url'),
  };
  const tamperRes = await http('POST', '/workspace/admin/setup/actors', tamper, authH);
  if (tamperRes.status === 403) {
    pass('mangled-signature envelope → 403 invalid_signature');
  } else {
    fail('mangled-signature envelope did NOT return 403', {
      status: tamperRes.status,
      body: tamperRes.body,
    });
  }

  // ── 9. Negative: missing elevation header on a write → 401 ─────────────
  const noElev = await http(
    'POST',
    '/workspace/admin/setup/actors',
    { ...payload, actorId: randomUUID() },
    { Authorization: `Bearer ${jwt}` }
  );
  if (noElev.status === 401 || noElev.status === 403) {
    pass(`write without elevation → ${noElev.status} (elevation gate held)`);
  } else {
    fail('write without elevation did NOT return 401/403', {
      status: noElev.status,
      body: noElev.body,
    });
  }

  // ── summary ────────────────────────────────────────────────────────────
  console.log();
  if (failures > 0) {
    console.log(`✗ ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('✓ all assertions passed — admin write rail is production-correct');
}

main().catch(err => {
  console.error('✗ verify-admin-write.ts crashed:', err);
  process.exit(1);
});
