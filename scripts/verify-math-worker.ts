/**
 * Verifies the SPEC-AGENT-PANEL-CATALOG end-to-end path:
 *   1. Login as dev-admin with the workspace api key.
 *   2. Open an elevated session via vault challenge/verify.
 *   3. Register a "math-worker" SUPERVISED_AGENT through the admin writer route.
 *   4. Confirm the agent appears in /workspace/admin/setup/catalog.allActors
 *      AND in /workspace/catalogs/agents (the workspace user-facing dropdown).
 *
 * Usage: assumes the server is already running on 127.0.0.1:7701.
 *   pnpm tsx scripts/verify-math-worker.ts
 *
 * Idempotent: if math-worker is already registered, it's deleted first.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const BASE = process.env['NEXUS_URL'] ?? 'http://127.0.0.1:7701';
const DEV_ADMIN_PRINCIPAL = '00000000-0000-4000-a000-000000000001';

interface ApiBody {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

async function req(
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: ApiBody }> {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: ApiBody = {};
  try {
    parsed = (await res.json()) as ApiBody;
  } catch {
    /* keep default */
  }
  return { status: res.status, body: parsed };
}

function bail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  // 1. Login
  const apiKeyPath = path.join(process.cwd(), 'keys', 'workspace-dev-admin.apikey');
  if (!fs.existsSync(apiKeyPath)) bail(`no key at ${apiKeyPath} — run nexus init`);
  const apiKey = fs.readFileSync(apiKeyPath, 'utf-8').trim();

  const login = await req('POST', '/workspace/auth/login', { type: 'api_key', value: apiKey });
  if (login.status !== 200 || !login.body.ok) {
    bail(`login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }
  const jwt = (login.body.data as { token?: string }).token;
  if (!jwt) bail('login response missing token');
  console.log('✓ logged in as dev-admin');

  const auth = { Authorization: `Bearer ${jwt}` };

  // 2. Elevated session
  const challenge = await req(
    'POST',
    '/workspace/vault/auth',
    { action: 'challenge', principalId: DEV_ADMIN_PRINCIPAL, method: 'api_key_reauth' },
    auth
  );
  if (challenge.status !== 200) bail(`challenge failed: ${JSON.stringify(challenge.body)}`);
  const challengeId = (challenge.body.data as { challengeId?: string }).challengeId;
  if (!challengeId) bail('challenge response missing challengeId');

  const verify = await req(
    'POST',
    '/workspace/vault/auth',
    {
      action: 'verify',
      challengeId,
      principalId: DEV_ADMIN_PRINCIPAL,
      method: 'api_key_reauth',
      response: apiKey,
    },
    auth
  );
  if (verify.status !== 200) bail(`verify failed: ${JSON.stringify(verify.body)}`);
  const elevatedSessionId = (verify.body.data as { elevatedSessionId?: string }).elevatedSessionId;
  if (!elevatedSessionId) bail('verify response missing elevatedSessionId');
  console.log(`✓ elevated session opened: ${elevatedSessionId.slice(0, 8)}…`);

  const adminAuth = { ...auth, 'X-Elevated-Session': elevatedSessionId };

  // 3a. Cleanup any leftover math-worker from a previous run.
  const beforeCatalog = await req('GET', '/workspace/admin/setup/catalog', undefined, adminAuth);
  if (beforeCatalog.status !== 200) {
    bail(`catalog GET failed: ${JSON.stringify(beforeCatalog.body)}`);
  }
  const beforeData = beforeCatalog.body.data as {
    allActors?: { actorId: string; displayName: string }[];
  };
  const existingMath = beforeData.allActors?.find(a => a.displayName === 'math-worker');
  if (existingMath) {
    const del = await req(
      'DELETE',
      `/workspace/admin/setup/actors/${existingMath.actorId}`,
      undefined,
      adminAuth
    );
    if (del.status !== 200) bail(`pre-cleanup delete failed: ${JSON.stringify(del.body)}`);
    console.log(`✓ pre-cleanup: removed prior math-worker (${existingMath.actorId.slice(0, 8)}…)`);
  }

  // 3b. Register math-worker.
  const mathActorId = randomUUID();
  const register = await req(
    'POST',
    '/workspace/admin/setup/actors',
    {
      actorId: mathActorId,
      actorClass: 'SUPERVISED_AGENT',
      principalId: DEV_ADMIN_PRINCIPAL,
      displayName: 'math-worker',
      environment: 'reference',
      octLevel: 'OCT-OPEN',
      riskCeiling: 'medium',
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single', 'synthesize:content'],
      enabled: true,
      registeredAt: new Date().toISOString(),
      owner: 'james',
      purpose: 'arithmetic worker for catalog smoke test',
      reviewCadence: 'quarterly',
    },
    adminAuth
  );
  if (register.status !== 200) {
    bail(`register failed (${register.status}): ${JSON.stringify(register.body)}`);
  }
  console.log(`✓ math-worker registered: ${mathActorId}`);

  // 4a. Confirm in admin catalog.
  const afterCatalog = await req('GET', '/workspace/admin/setup/catalog', undefined, adminAuth);
  const afterData = afterCatalog.body.data as {
    allActors?: { actorId: string; displayName: string; enabled?: boolean }[];
  };
  const inCatalog = afterData.allActors?.find(a => a.actorId === mathActorId);
  if (!inCatalog) bail('math-worker missing from catalog.allActors');
  if (inCatalog.displayName !== 'math-worker' || inCatalog.enabled === false) {
    bail(`math-worker shape wrong in catalog: ${JSON.stringify(inCatalog)}`);
  }
  console.log('✓ math-worker present in /workspace/admin/setup/catalog.allActors');

  // 4b. Confirm in workspace user-facing agent catalog.
  const wsAgents = await req('GET', '/workspace/catalogs/agents', undefined, auth);
  if (wsAgents.status !== 200) bail(`agents catalog failed: ${JSON.stringify(wsAgents.body)}`);
  const items = wsAgents.body.data as { id: string; name: string; selectable: boolean }[];
  const inWs = items.find(i => i.id === mathActorId);
  if (!inWs)
    bail(`math-worker missing from /workspace/catalogs/agents (got ${items.length} items)`);
  if (!inWs.selectable) bail(`math-worker present but not selectable: ${JSON.stringify(inWs)}`);
  console.log(
    `✓ math-worker present in /workspace/catalogs/agents — ` +
      `${items.length} total agent(s) visible to dev-admin`
  );

  // 5. Disable test: ensure disabled agent stays visible but becomes non-selectable.
  const disable = await req(
    'PUT',
    `/workspace/admin/setup/actors/${mathActorId}`,
    { enabled: false },
    adminAuth
  );
  if (disable.status !== 200) bail(`disable failed: ${JSON.stringify(disable.body)}`);
  const wsAgents2 = await req('GET', '/workspace/catalogs/agents', undefined, auth);
  const items2 = wsAgents2.body.data as { id: string; selectable: boolean; reason?: string }[];
  const disabled = items2.find(i => i.id === mathActorId);
  if (!disabled)
    bail('disabled agent disappeared from catalog (expected: visible, not selectable)');
  if (disabled.selectable) bail('disabled agent still selectable');
  console.log(`✓ disable behaviour: visible=${!!disabled} selectable=${disabled.selectable}`);

  // Re-enable so subsequent runs see it active.
  await req('PUT', `/workspace/admin/setup/actors/${mathActorId}`, { enabled: true }, adminAuth);

  console.log('\n=== math-worker verification PASSED ===');
}

main().catch(err => {
  console.error('script error:', err);
  process.exit(1);
});
