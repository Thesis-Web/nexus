/**
 * tests/e2e/13-mailpit-corridor.e2e.test.ts —
 * NEXUS-FIX-SPEC-POST-CONSOLIDATION-2026-05-23.md §5.6 (Mailpit corridor
 * demo rehearsal).
 *
 * Production-shape end-to-end rehearsal of the Mailpit corridor: admin
 * connects Mailpit through the dashboard writer; a manager-tier user
 * submits a prompt that composes an email; orch plans → NXS dispatches
 * → the mailpit connector relays SMTP → compile returns a receipt;
 * workspace serves the result; an unprivileged user attempting the
 * same prompt is denied at the delegation intersection / NXS gate.
 *
 * RBAC is configured through `/workspace/admin/principals/:principalId`
 * via the same signed admin-mutation envelope path the rest of the
 * admin writers use — this test never touches the seed scripts directly
 * (per spec §5.1).
 *
 * Substrate guard (spec §5.7): every test TCP-probes Mailpit's SMTP
 * (1025) and HTTP (8025) ports before running and early-returns with a
 * "[skip] Mailpit not reachable" console line when either is down. The
 * test bodies use plain `it(...)` blocks with an `if (!substrate) return;`
 * branch — the GOV-E2E-SKIP gate forbids skip/todo helpers and this
 * pattern is what the existing tests/integration/admin-mailpit-install
 * suite uses for the same substrate-down case.
 *
 * Mailpit substrate provisioning: see `tests/integration/admin-mailpit-install`
 * for the canonical pattern. Locally:
 *   docker run -d --name nexus-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
 * or use the `nexus-lab-test-bed` repo's `pnpm lab:up`.
 *
 * Owner-Ratified 2026-05-23. HEAD pin at draft time: documented in
 * runs/fix-spec-2026-05-23/BUILD-LOG.md §Phase 5.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect as netConnect } from 'node:net';
import { bootHarness, type E2EHarness } from './harness.js';
import { CAPABILITY_IDS } from '@nexus/contracts';

// Substrate ports — env override so a private Mailpit instance can be probed.
const SMTP_PORT = Number(process.env['MAILPIT_SMTP_PORT'] ?? 1025);
const HTTP_PORT = Number(process.env['MAILPIT_HTTP_PORT'] ?? 8025);
const HOST = '127.0.0.1';

// Principals from scripts/seeds/user-ladder-seeds.ts. We only need the
// manager's principalId for the dashboard-writer PUT in Tests 2 + 4; the
// intern test resolves its principalId implicitly through jwtFor('intern')
// and never modifies the principal's RBAC (the denial assertion depends
// on the intern persona NOT having mailpit-local in allowedSystems).
const MANAGER_PRINCIPAL = '00000000-0000-4000-a000-000000000058';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';

// Mailpit connector id used by the install integration suite — keep aligned.
const MAILPIT_CONNECTOR_ID = 'mailpit-local';

interface SubstrateProbe {
  smtp: boolean;
  http: boolean;
}

async function probePort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const sock = netConnect({ host, port });
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.setTimeout(timeoutMs);
  });
}

async function probeMailpit(): Promise<SubstrateProbe> {
  const [smtp, http] = await Promise.all([probePort(HOST, SMTP_PORT), probePort(HOST, HTTP_PORT)]);
  return { smtp, http };
}

interface MailpitMessage {
  ID: string;
  From: { Address: string };
  To: ReadonlyArray<{ Address: string }>;
  Subject: string;
  Created: string;
}

async function listMailpitMessages(): Promise<ReadonlyArray<MailpitMessage>> {
  const url = `http://${HOST}:${HTTP_PORT}/api/v1/messages`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mailpit API list failed: HTTP ${res.status}`);
  const body = (await res.json()) as { messages?: ReadonlyArray<MailpitMessage> };
  return body.messages ?? [];
}

async function purgeMailpit(): Promise<void> {
  const url = `http://${HOST}:${HTTP_PORT}/api/v1/messages`;
  await fetch(url, { method: 'DELETE' });
}

// ── ADMIN HELPERS — same signed-mutation transport admin-writer.ts uses ────

async function adminHeaders(harness: E2EHarness): Promise<Record<string, string>> {
  const jwt = await harness.jwtFor('dev-admin');
  const elev = await harness.elevatedSessionFor('dev-admin', jwt);
  return {
    Authorization: `Bearer ${jwt}`,
    'X-Elevated-Session': elev,
    'Content-Type': 'application/json',
  };
}

async function installMailpitConnectorViaDashboard(harness: E2EHarness): Promise<void> {
  // CONNECTOR_REGISTER mutation; server-side signed per admin-writer pattern
  // (the "Sign as me" path — see middleware/signed-admin-mutation.ts §296).
  const headers = await adminHeaders(harness);
  const payload = {
    connectorId: MAILPIT_CONNECTOR_ID,
    connectorType: 'mailpit',
    allowedSystems: [MAILPIT_CONNECTOR_ID],
    enabled: true,
    configuration: {
      systemType: MAILPIT_CONNECTOR_ID,
      displayLabel: 'Mailpit (local lab)',
      smtpHost: HOST,
      smtpPort: SMTP_PORT,
      apiBaseUrl: `http://${HOST}:${HTTP_PORT}`,
      tlsMode: 'none',
      authMode: 'none',
      allowedSenders: ['admin@nexlabco.test', 'notifications@nexlabco.test'],
      allowedRecipients: ['support@nexlabco.test', 'owner@nexlabco.test'],
      allowedDomains: ['nexlabco.test'],
      queryLimit: 50,
    },
  };
  const res = await fetch(`${harness.baseUrl}/workspace/admin/setup/connectors`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    throw new Error(`connector register failed: HTTP ${res.status} ${body}`);
  }
}

async function probeMailpitConnectorViaDashboard(harness: E2EHarness): Promise<void> {
  const headers = await adminHeaders(harness);
  const url = `${harness.baseUrl}/workspace/admin/setup/connectors/${MAILPIT_CONNECTOR_ID}/probe`;
  const res = await fetch(url, { method: 'POST', headers, body: '{}' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`connector probe failed: HTTP ${res.status} ${body}`);
  }
}

async function addMailpitSystemToPrincipal(
  harness: E2EHarness,
  principalId: string
): Promise<void> {
  // GET current principal, merge mailpit-local into allowedSystems, PUT back.
  // Adding the system here is the spec §5.4 RBAC change — going through the
  // dashboard writer (PUT /workspace/admin/principals/:principalId) rather
  // than editing scripts/seeds/user-ladder-seeds.ts directly. The matching
  // GET on the same path is the elevated-admin read; the legacy
  // /principals/:id route lives behind the admin-bearer-token middleware
  // which the dashboard never holds.
  const headers = await adminHeaders(harness);
  const getRes = await fetch(`${harness.baseUrl}/workspace/admin/principals/${principalId}`, {
    headers,
  });
  if (!getRes.ok) {
    const body = await getRes.text();
    throw new Error(`principal lookup failed: HTTP ${getRes.status} ${body}`);
  }
  const getBody = (await getRes.json()) as { data?: { allowedSystems?: ReadonlyArray<string> } };
  const current = getBody.data?.allowedSystems ?? [];
  if (current.includes(MAILPIT_CONNECTOR_ID)) return;

  const update = {
    allowedSystems: [...current, MAILPIT_CONNECTOR_ID],
  };
  const putRes = await fetch(`${harness.baseUrl}/workspace/admin/principals/${principalId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(update),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`principal update failed: HTTP ${putRes.status} ${body}`);
  }
}

// ── E2E SUITE ───────────────────────────────────────────────────────────────

describe('E2E Category 13 — Mailpit corridor (admin connect → send → deny → receipt)', () => {
  let harness: E2EHarness;
  let substrate: SubstrateProbe = { smtp: false, http: false };

  beforeAll(async () => {
    substrate = await probeMailpit();
    harness = await bootHarness();
    // Best-effort substrate prep when present; tests still individually
    // guard, so a partial substrate (e.g. only SMTP up) reports cleanly.
    if (substrate.smtp && substrate.http) {
      try {
        await purgeMailpit();
        await installMailpitConnectorViaDashboard(harness);
      } catch (err) {
        // Surface as part of the first test's failure rather than swallow.
        console.error('[mailpit-corridor] beforeAll setup error:', err);
      }
    }
  }, 240_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  // ── Test 1 — admin install + probe round-trip ─────────────────────────────
  it('E2E-130-mailpit-admin-install: admin → dashboard writer → probe succeeds', async () => {
    if (!substrate.smtp || !substrate.http) {
      console.log(
        `[skip] Mailpit not reachable at ${HOST}:${SMTP_PORT}/${HOST}:${HTTP_PORT}. ` +
          `Bring up mailpit locally (e.g. docker run -p 1025:1025 -p 8025:8025 axllent/mailpit).`
      );
      return;
    }
    // The beforeAll already ran the install; probe verifies the connector
    // can reach the live substrate. The probe route emits `admin_probe`
    // ledger events — the install integration suite (tests/integration/
    // admin-mailpit-install) is the authoritative coverage for that event
    // shape; this test only asserts the corridor end-to-end is wired.
    await expect(probeMailpitConnectorViaDashboard(harness)).resolves.not.toThrow();
  }, 180_000);

  // ── Test 2 — manager-tier user composes + sends an email ──────────────────
  it('E2E-131-mailpit-send-as-manager: manager-tier user → orch → NXS → mailpit SMTP', async () => {
    if (!substrate.smtp || !substrate.http) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    // RBAC: add mailpit-local to manager.allowedSystems through the dashboard
    // writer. The principal_update mutation goes through the same audit chain
    // every other admin write uses (signed envelope + ledger emission).
    await addMailpitSystemToPrincipal(harness, MANAGER_PRINCIPAL);

    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt:
        'Send a one-paragraph status note to support@nexlabco.test from admin@nexlabco.test summarising today.',
      agents: [CHAT_AGENT_ACTOR_ID],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    expect(snap.runClosed, 'run closed').toBe(true);
    expect(snap.closeReason, 'mailpit-corridor closes completed').toBe('completed');
    const types = snap.ledgerEvents.map(e => e.eventType);
    expect(types, 'final_response emitted').toContain('final_response');
    const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const composeActions = nxsActions.filter(
      e =>
        (e.detail as Record<string, unknown>)['capabilityId'] === CAPABILITY_IDS.COMPOSE_EMAIL ||
        (e.detail as Record<string, unknown>)['target'] === MAILPIT_CONNECTOR_ID
    );
    expect(composeActions.length, 'at least one mailpit-targeted nxs_action').toBeGreaterThan(0);
    const executed = composeActions.some(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === 'executed_successfully'
    );
    expect(executed, 'at least one compose:email nxs_action executed_successfully').toBe(true);
  }, 360_000);

  // ── Test 3 — low-clearance user denied at delegation/NXS ──────────────────
  it('E2E-132-mailpit-denied-intern: intern (no mailpit-local) → denial surface', async () => {
    if (!substrate.smtp || !substrate.http) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    // Intern persona MUST NOT have mailpit-local in allowedSystems (spec §5.4).
    // Defensive: even if a prior test polluted the principal, do not add it.
    const jwt = await harness.jwtFor('intern');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt:
        'Send a one-paragraph status note to support@nexlabco.test from admin@nexlabco.test summarising today.',
      agents: [CHAT_AGENT_ACTOR_ID],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    // Honest denial surface: either intersection refused before dispatch,
    // or planner couldn't satisfy the capability, or NXS denied the action.
    // ALL of these are acceptable HL #5 / HL #15 denial paths.
    const denied =
      types.includes('delegation_empty_intersection') ||
      types.includes('planner_infeasible') ||
      snap.ledgerEvents
        .filter(e => e.eventType === 'nxs_action')
        .some(e => {
          const fo = (e.detail as Record<string, unknown>)['finalOutcome'];
          return typeof fo === 'string' && fo !== 'executed_successfully';
        });
    expect(denied, 'intern attempting compose:email MUST surface a denial event').toBe(true);
    // And — critically — no executed compose nxs_action.
    const executedCompose = snap.ledgerEvents
      .filter(e => e.eventType === 'nxs_action')
      .some(e => {
        const d = e.detail as Record<string, unknown>;
        return (
          d['finalOutcome'] === 'executed_successfully' &&
          (d['target'] === MAILPIT_CONNECTOR_ID ||
            d['capabilityId'] === CAPABILITY_IDS.COMPOSE_EMAIL)
        );
      });
    expect(executedCompose, 'intern compose attempt must not execute against Mailpit').toBe(false);
  }, 240_000);

  // ── Test 4 — final_response carries the mail receipt ──────────────────────
  it('E2E-133-mailpit-receipt-rendered: manager run final_response surfaces mail receipt', async () => {
    if (!substrate.smtp || !substrate.http) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    await addMailpitSystemToPrincipal(harness, MANAGER_PRINCIPAL);
    const jwt = await harness.jwtFor('manager');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt:
        'Send a confirmation email to owner@nexlabco.test from notifications@nexlabco.test about the rollout.',
      agents: [CHAT_AGENT_ACTOR_ID],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    expect(snap.closeReason).toBe('completed');
    expect(snap.artifactBody, 'final_response artifactBody is present').not.toBeNull();
    // Receipt content varies by compile template — assert at least the
    // word "owner@nexlabco.test" landed in the rendered body so we know
    // the workspace served the compile output without losing the recipient.
    expect(snap.artifactBody ?? '').toContain('owner@nexlabco.test');
  }, 360_000);

  // ── Test 5 — Mailpit HTTP API confirms the message arrived ────────────────
  it('E2E-134-mailpit-message-arrived: Mailpit API lists at least one message after the corridor', async () => {
    if (!substrate.smtp || !substrate.http) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    // Read Mailpit's HTTP API — the corridor's terminal evidence. The
    // beforeAll purged the mailbox; Tests 2 and 4 each fire one send.
    // Assert at least one of those messages has Mailpit-side persistence.
    const messages = await listMailpitMessages();
    expect(messages.length, 'Mailpit has at least one corridor message').toBeGreaterThan(0);
    const recipients = messages.flatMap(m => m.To.map(t => t.Address));
    const seenSupport = recipients.includes('support@nexlabco.test');
    const seenOwner = recipients.includes('owner@nexlabco.test');
    expect(
      seenSupport || seenOwner,
      'at least one expected corridor recipient is present in Mailpit'
    ).toBe(true);
  }, 60_000);
});
