/**
 * tests/e2e/00b-persona-rbac-seeds.e2e.test.ts
 *
 * Persona / RBAC seed proof — Phase-0 follow-on to the acceptance spine.
 *
 * Asserts the seeded principal/actor surface matches the spec:
 *   E2E-012 — 10 user-ladder roles + 1 admin operator (dev-admin) exist
 *   E2E-013 — each user has paired Principal + Actor with no mismatch
 *   E2E-014 — capability ceilings are explicit; no wildcard authority;
 *             no empty-as-any
 *   E2E-015 — every actor carries a canonical OCT level
 *   E2E-016 — admin_operator (dev-admin) is structurally separated from
 *             business users by role assignment (nexus-admin only, no
 *             workspace-user; conversely every ladder user has only
 *             workspace-user, no nexus-admin)
 *   E2E-017 — CEO has full business capabilities but the nexus-admin
 *             role gate still governs: a signed admin write as CEO
 *             MUST fail closed, and the catalog read MUST also 401/403.
 *
 * Acceptance-spine rule: every test in this file is real and fails red
 * on regression. No it.skip, no it.todo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { bootHarness, type E2EHarness } from './harness.js';
import { USER_LADDER, type UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const DEV_ADMIN_PRINCIPAL = '00000000-0000-4000-a000-000000000001';
const DEV_ADMIN_ACTOR = '00000000-0000-4000-a000-000000000002';
const NEXUS_ADMIN_ROLE = 'nexus-admin';
const WORKSPACE_USER_ROLE = 'workspace-user';

// The owner's E2E-012 enumeration names ten business personas plus
// admin_operator (which maps to the dev-admin principal seeded by
// nexus-bootstrap). The canonical USER_LADDER seed registers all ten
// business roles (incl. 'executive'); we assert each one explicitly so
// a future ladder edit cannot drop a role without flipping this test
// red.
const REQUIRED_USER_LADDER: ReadonlyArray<UserLadderRole> = [
  'janitor',
  'intern',
  'analyst',
  'sr_analyst',
  'manager',
  'sr_manager',
  'director',
  'vp',
  'executive',
  'ceo',
];

interface CatalogActor {
  actorId: string;
  actorClass: string;
  principalId: string;
  displayName: string;
  environment: string;
  octLevel: string | null;
  riskCeiling: string;
  allowedSystems: ReadonlyArray<string>;
  allowedCapabilities?: ReadonlyArray<string>;
  enabled?: boolean;
  roles?: ReadonlyArray<string>;
}

interface CatalogPrincipal {
  principalId: string;
  displayName: string;
  email: string;
  registeredAt: string;
  maxDelegableRiskTier: string;
  allowedSystems: ReadonlyArray<string>;
}

interface CatalogPayload {
  allActors: ReadonlyArray<CatalogActor>;
  principals: ReadonlyArray<CatalogPrincipal>;
  capabilityIds: ReadonlyArray<string>;
  octLevels: ReadonlyArray<{ id: string }>;
}

async function fetchCatalog(
  baseUrl: string,
  jwt: string,
  elevatedSessionId: string
): Promise<CatalogPayload> {
  const res = await fetch(`${baseUrl}/workspace/admin/setup/catalog`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Elevated-Session': elevatedSessionId,
    },
  });
  const body = (await res.json()) as {
    ok: boolean;
    data?: CatalogPayload;
    error?: string;
  };
  if (!body.ok || !body.data) {
    throw new Error(`catalog fetch failed: status=${res.status} error=${body.error ?? ''}`);
  }
  return body.data;
}

describe('E2E Persona / RBAC seed proof', () => {
  let harness: E2EHarness;
  let devAdminJwt: string;
  let devAdminElev: string;
  let catalog: CatalogPayload;

  beforeAll(async () => {
    harness = await bootHarness();
    devAdminJwt = await harness.jwtFor('dev-admin');
    devAdminElev = await harness.elevatedSessionFor('dev-admin', devAdminJwt);
    catalog = await fetchCatalog(harness.baseUrl, devAdminJwt, devAdminElev);
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-012 seeded users exist (10 ladder + admin_operator)', () => {
    // admin_operator = dev-admin principal seeded by nexus-bootstrap.
    const devAdmin = catalog.principals.find(p => p.principalId === DEV_ADMIN_PRINCIPAL);
    expect(devAdmin, 'dev-admin (admin_operator) principal').toBeDefined();
    expect(devAdmin?.displayName).toBe('dev-admin');

    // Each user-ladder role must be present by both principalId and displayName.
    for (const role of REQUIRED_USER_LADDER) {
      const spec = USER_LADDER.find(u => u.role === role);
      expect(spec, `USER_LADDER must define ${role}`).toBeDefined();
      const p = catalog.principals.find(pp => pp.principalId === spec!.principalId);
      expect(p, `principal for ${role} (${spec!.principalId})`).toBeDefined();
      expect(p!.displayName).toBe(spec!.displayName);
      expect(p!.email).toBe(spec!.email);
    }
  });

  it('E2E-013 each user has paired actor + principal with no mismatch', () => {
    const requiredPrincipalIds = new Set<string>([
      DEV_ADMIN_PRINCIPAL,
      ...REQUIRED_USER_LADDER.map(r => USER_LADDER.find(u => u.role === r)!.principalId),
    ]);
    for (const pid of requiredPrincipalIds) {
      // The principal exists.
      const p = catalog.principals.find(pp => pp.principalId === pid);
      expect(p, `principal ${pid}`).toBeDefined();
      // At least one actor whose principalId matches.
      const actors = catalog.allActors.filter(a => a.principalId === pid);
      expect(actors.length, `actors paired with principal ${pid}`).toBeGreaterThan(0);
      // No actor with mismatched principalId field.
      for (const a of actors) {
        expect(a.principalId).toBe(pid);
      }
    }
    // Broader invariant: every actor in the registry must resolve to a
    // registered principal — no orphans.
    const principalSet = new Set(catalog.principals.map(p => p.principalId));
    for (const a of catalog.allActors) {
      expect(
        principalSet.has(a.principalId),
        `actor ${a.actorId} (${a.displayName}) has orphan principalId ${a.principalId}`
      ).toBe(true);
    }
  });

  it('E2E-014 capability ceilings are explicit — no wildcard authority, no empty-as-any', () => {
    const WILDCARD = '*';
    for (const actor of catalog.allActors) {
      expect(Array.isArray(actor.allowedSystems), `${actor.displayName} allowedSystems array`).toBe(
        true
      );
      expect(
        actor.allowedSystems.includes(WILDCARD),
        `${actor.displayName} wildcard allowedSystems`
      ).toBe(false);
      expect(
        Array.isArray(actor.allowedCapabilities),
        `${actor.displayName} allowedCapabilities array`
      ).toBe(true);
      expect(
        (actor.allowedCapabilities ?? []).includes(WILDCARD),
        `${actor.displayName} wildcard allowedCapabilities`
      ).toBe(false);
      // No empty-as-any: capabilities array must always carry at least
      // one explicit ceiling (the janitor's allowedSystems may legally
      // be [] — search:public requires no system — but allowedCapabilities
      // must never be empty).
      expect(
        (actor.allowedCapabilities ?? []).length,
        `${actor.displayName} allowedCapabilities non-empty`
      ).toBeGreaterThan(0);
    }
    // Catalog's published capability taxonomy itself must not include '*'.
    expect(catalog.capabilityIds.includes(WILDCARD)).toBe(false);
  });

  it('E2E-015 OCT is assigned for every actor from the canonical set', () => {
    const validOctLevels = new Set(catalog.octLevels.map(o => o.id));
    // Outline §16 hard laws — three live OCT levels post-rework.
    expect(validOctLevels.has('OCT-OPEN')).toBe(true);
    expect(validOctLevels.has('OCT-CONFIDENTIAL')).toBe(true);
    expect(validOctLevels.has('OCT-SECURE')).toBe(true);

    for (const actor of catalog.allActors) {
      expect(actor.octLevel, `${actor.displayName} has an OCT level`).toBeTruthy();
      expect(
        validOctLevels.has(actor.octLevel!),
        `${actor.displayName} OCT '${actor.octLevel}' is in canonical set`
      ).toBe(true);
    }
  });

  it('E2E-016 admin_operator is structurally separated from business users by role', () => {
    // dev-admin (admin_operator): nexus-admin role only; no workspace-user.
    const devAdminActor = catalog.allActors.find(a => a.actorId === DEV_ADMIN_ACTOR);
    expect(devAdminActor, 'dev-admin actor record').toBeDefined();
    const adminRoles = new Set(devAdminActor!.roles ?? []);
    expect(adminRoles.has(NEXUS_ADMIN_ROLE), 'dev-admin has nexus-admin role').toBe(true);
    expect(
      adminRoles.has(WORKSPACE_USER_ROLE),
      'dev-admin must NOT carry workspace-user role'
    ).toBe(false);

    // Every ladder business user: workspace-user only; no nexus-admin.
    // This is what stops a CEO (or any business user) from invoking
    // admin-write routes even when their capability set is broad.
    for (const role of REQUIRED_USER_LADDER) {
      const spec = USER_LADDER.find(u => u.role === role)!;
      const actor = catalog.allActors.find(a => a.actorId === spec.actorId);
      expect(actor, `actor for ${role}`).toBeDefined();
      const r = new Set(actor!.roles ?? []);
      expect(r.has(WORKSPACE_USER_ROLE), `${role} carries workspace-user role`).toBe(true);
      expect(r.has(NEXUS_ADMIN_ROLE), `${role} must NOT carry nexus-admin role`).toBe(false);
    }
  });

  it('E2E-017 CEO is still governed — cannot bypass admin-role gate', async () => {
    // CEO has full business capability set including admin:write +
    // admin:override capability TOKENS, but role-based governance is the
    // gate that actually runs: an admin route requires the nexus-admin
    // ROLE assignment, which CEO does not have.
    const ceoJwt = await harness.jwtFor('ceo');
    const ceoElev = await harness.elevatedSessionFor('ceo', ceoJwt);
    // Elevation itself succeeds — CEO can prove identity. Governance is
    // not by reachability; it is by role.
    expect(ceoElev).toMatch(/^[0-9a-f-]{36}$/);

    // CEO tries a signed admin write — same payload Phase 0 uses. Must
    // fail closed because checkAdminAuth requires nexus-admin role.
    const writePayload = {
      actorId: randomUUID(),
      actorClass: 'SUPERVISED_AGENT',
      displayName: 'e2e-017-ceo-bypass-attempt',
      principalId: DEV_ADMIN_PRINCIPAL,
      environment: 'reference',
      riskCeiling: 'low',
      octLevel: 'OCT-OPEN',
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single'],
      owner: 'tests/e2e/00b-persona-rbac-seeds',
      purpose: 'CEO bypass attempt (must fail closed)',
      reviewCadence: 'quarterly',
    };
    const writeRes = await fetch(`${harness.baseUrl}/workspace/admin/setup/actors`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ceoJwt}`,
        'X-Elevated-Session': ceoElev,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(writePayload),
    });
    expect([401, 403]).toContain(writeRes.status);

    // The admin catalog READ must also fail for CEO — same auth gate.
    const catRes = await fetch(`${harness.baseUrl}/workspace/admin/setup/catalog`, {
      headers: {
        Authorization: `Bearer ${ceoJwt}`,
        'X-Elevated-Session': ceoElev,
      },
    });
    expect([401, 403]).toContain(catRes.status);
  });
});
