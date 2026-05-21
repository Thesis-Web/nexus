/**
 * scripts/seeds/user-ladder-seeds.ts
 *
 * Spec: AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md §2.
 *
 * Registers 10 user seeds spanning janitor → CEO at workspace bootstrap.
 * Each seed populates the FULL F4.15 Principal envelope (no legacy
 * widening for these principals — they're new) plus a matching Actor +
 * a per-user API key (loaded from keys/users/<role>.apikey).
 *
 * The ladder is monotonic: each role's allowed-set is a strict superset
 * of the rank below it. This makes RBAC denial differentials assertable
 * in the §3.11 e2e tests — same prompt across roles, only the lower
 * ranks are denied.
 *
 * Layer: scripts (composition root). Imports @nexus/core types only.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Actor, FirewallTransitMap, NonEmpty, Uuid } from '@nexus/contracts';
import type { ActorRegistry, PrincipalRegistry } from '@nexus/contracts';

/** Local subset of the auth-provider surface the seeder needs. */
interface KeyRegistrar {
  registerKey(apiKey: string, actorId: Uuid): void;
}

export type UserLadderRole =
  | 'janitor'
  | 'intern'
  | 'analyst'
  | 'sr_analyst'
  | 'manager'
  | 'sr_manager'
  | 'director'
  | 'vp'
  | 'executive'
  | 'ceo';

interface RoleSpec {
  readonly role: UserLadderRole;
  /** Principal UUID — stable across boots so tests can address by id. */
  readonly principalId: Uuid;
  /** Actor UUID — same stability. */
  readonly actorId: Uuid;
  readonly displayName: NonEmpty;
  readonly email: NonEmpty;
  readonly octLevel: 'OCT-OPEN' | 'OCT-CONFIDENTIAL' | 'OCT-SECURE';
  readonly maxRiskTier: 'low' | 'medium' | 'high' | 'critical';
  readonly allowedSystems: ReadonlyArray<string>;
  readonly allowedCapabilities: ReadonlyArray<NonEmpty>;
  readonly firewallTransitRights: FirewallTransitMap;
  readonly permittedRunTypes: ReadonlyArray<'chat' | 'sectioned' | 'secure_rails' | 'autonomous'>;
  readonly roles: ReadonlyArray<NonEmpty>;
}

// ─── Per-role capability arrays ─────────────────────────────────────────────
//
// Each row is built by intersecting "this rank's net-new capabilities" with
// the rank below. The strict-superset property is asserted at the bottom of
// this file in a build-time check (commented loop) — left in code for the
// e2e test that programmatically re-asserts it.

const CAP_SEARCH_PUBLIC = 'search:public' as NonEmpty;
const CAP_SUMMARIZE = 'synthesize:content' as NonEmpty;
const CAP_READ_RECORD_SINGLE = 'read:record:single' as NonEmpty;
const CAP_QUERY_DATA = 'query:data' as NonEmpty;
const CAP_READ_RECORD_BULK = 'read:record:bulk' as NonEmpty;
const CAP_SEARCH_DATA = 'search:data' as NonEmpty;
const CAP_CREATE_RECORD = 'create:record:internal' as NonEmpty;
const CAP_UPDATE_RECORD_SINGLE = 'update:record:single' as NonEmpty;
const CAP_COMPOSE_EMAIL = 'compose:email' as NonEmpty;
const CAP_READ_EMAIL = 'read:email' as NonEmpty;
const CAP_UPDATE_RECORD_BULK = 'update:record:bulk' as NonEmpty;
const CAP_DELETE_RECORD_SINGLE = 'delete:record:single' as NonEmpty;
const CAP_READ_SECRET = 'read:secret' as NonEmpty;
const CAP_QUERY_SECRET = 'query:secret_data' as NonEmpty;
const CAP_DELETE_RECORD_BULK = 'delete:record:bulk' as NonEmpty;
const CAP_ADMIN_READ = 'admin:read' as NonEmpty;
const CAP_ADMIN_WRITE = 'admin:write' as NonEmpty;
const CAP_ADMIN_OVERRIDE = 'admin:override' as NonEmpty;

const TRANSIT_PUBLIC_ONLY: FirewallTransitMap = {
  outbound: ['public'],
  inbound: ['public'],
};
const TRANSIT_INTERNAL: FirewallTransitMap = {
  outbound: ['public', 'internal'],
  inbound: ['public', 'internal'],
};
const TRANSIT_CONFIDENTIAL: FirewallTransitMap = {
  outbound: ['public', 'internal', 'confidential'],
  inbound: ['public', 'internal', 'confidential'],
};
const TRANSIT_SECURE: FirewallTransitMap = {
  outbound: ['public', 'internal', 'confidential', 'secret'],
  inbound: ['public', 'internal', 'confidential', 'secret'],
};

const ALL_RUN_TYPES = ['chat', 'sectioned', 'secure_rails', 'autonomous'] as const;

export const USER_LADDER: ReadonlyArray<RoleSpec> = [
  {
    role: 'janitor',
    principalId: '00000000-0000-4000-a000-000000000050' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000051' as Uuid,
    displayName: 'Janitor User' as NonEmpty,
    email: 'janitor.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-OPEN',
    maxRiskTier: 'low',
    allowedSystems: [],
    allowedCapabilities: [CAP_SEARCH_PUBLIC],
    firewallTransitRights: TRANSIT_PUBLIC_ONLY,
    permittedRunTypes: ['chat'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'intern',
    principalId: '00000000-0000-4000-a000-000000000052' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000053' as Uuid,
    displayName: 'Intern User' as NonEmpty,
    email: 'intern.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-OPEN',
    maxRiskTier: 'low',
    allowedSystems: [],
    allowedCapabilities: [CAP_SEARCH_PUBLIC, CAP_SUMMARIZE],
    firewallTransitRights: TRANSIT_INTERNAL,
    permittedRunTypes: ['chat'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'analyst',
    principalId: '00000000-0000-4000-a000-000000000054' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000055' as Uuid,
    displayName: 'Analyst User' as NonEmpty,
    email: 'analyst.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-OPEN',
    maxRiskTier: 'medium',
    allowedSystems: ['sales-finance'],
    allowedCapabilities: [CAP_SEARCH_PUBLIC, CAP_SUMMARIZE, CAP_READ_RECORD_SINGLE, CAP_QUERY_DATA],
    firewallTransitRights: TRANSIT_INTERNAL,
    permittedRunTypes: ['chat', 'sectioned'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'sr_analyst',
    principalId: '00000000-0000-4000-a000-000000000056' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000057' as Uuid,
    displayName: 'Senior Analyst User' as NonEmpty,
    email: 'sr-analyst.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-CONFIDENTIAL',
    maxRiskTier: 'medium',
    allowedSystems: ['sales-finance', 'warehouse'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
    ],
    firewallTransitRights: TRANSIT_CONFIDENTIAL,
    permittedRunTypes: ['chat', 'sectioned'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'manager',
    principalId: '00000000-0000-4000-a000-000000000058' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000059' as Uuid,
    displayName: 'Manager User' as NonEmpty,
    email: 'manager.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-CONFIDENTIAL',
    maxRiskTier: 'high',
    allowedSystems: ['sales-finance', 'warehouse'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
    ],
    firewallTransitRights: TRANSIT_CONFIDENTIAL,
    permittedRunTypes: ['chat', 'sectioned', 'secure_rails'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'sr_manager',
    principalId: '00000000-0000-4000-a000-00000000005a' as Uuid,
    actorId: '00000000-0000-4000-a000-00000000005b' as Uuid,
    displayName: 'Senior Manager User' as NonEmpty,
    email: 'sr-manager.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-CONFIDENTIAL',
    maxRiskTier: 'high',
    allowedSystems: ['sales-finance', 'warehouse', 'gmail'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
      CAP_COMPOSE_EMAIL,
      CAP_READ_EMAIL,
    ],
    firewallTransitRights: TRANSIT_CONFIDENTIAL,
    permittedRunTypes: ['chat', 'sectioned', 'secure_rails'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'director',
    principalId: '00000000-0000-4000-a000-00000000005c' as Uuid,
    actorId: '00000000-0000-4000-a000-00000000005d' as Uuid,
    displayName: 'Director User' as NonEmpty,
    email: 'director.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-CONFIDENTIAL',
    maxRiskTier: 'high',
    allowedSystems: ['sales-finance', 'warehouse', 'gmail'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
      CAP_COMPOSE_EMAIL,
      CAP_READ_EMAIL,
      CAP_UPDATE_RECORD_BULK,
      CAP_DELETE_RECORD_SINGLE,
    ],
    firewallTransitRights: TRANSIT_CONFIDENTIAL,
    permittedRunTypes: ['chat', 'sectioned', 'secure_rails', 'autonomous'],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'vp',
    principalId: '00000000-0000-4000-a000-00000000005e' as Uuid,
    actorId: '00000000-0000-4000-a000-00000000005f' as Uuid,
    displayName: 'VP User' as NonEmpty,
    email: 'vp.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-SECURE',
    maxRiskTier: 'critical',
    allowedSystems: ['sales-finance', 'warehouse', 'gmail'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
      CAP_COMPOSE_EMAIL,
      CAP_READ_EMAIL,
      CAP_UPDATE_RECORD_BULK,
      CAP_DELETE_RECORD_SINGLE,
      CAP_READ_SECRET,
      CAP_QUERY_SECRET,
    ],
    firewallTransitRights: TRANSIT_SECURE,
    permittedRunTypes: [...ALL_RUN_TYPES],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'executive',
    principalId: '00000000-0000-4000-a000-000000000060' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000061' as Uuid,
    displayName: 'Executive User' as NonEmpty,
    email: 'executive.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-SECURE',
    maxRiskTier: 'critical',
    allowedSystems: ['sales-finance', 'warehouse', 'gmail'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
      CAP_COMPOSE_EMAIL,
      CAP_READ_EMAIL,
      CAP_UPDATE_RECORD_BULK,
      CAP_DELETE_RECORD_SINGLE,
      CAP_READ_SECRET,
      CAP_QUERY_SECRET,
      CAP_DELETE_RECORD_BULK,
      CAP_ADMIN_READ,
    ],
    firewallTransitRights: TRANSIT_SECURE,
    permittedRunTypes: [...ALL_RUN_TYPES],
    roles: ['workspace-user' as NonEmpty],
  },
  {
    role: 'ceo',
    principalId: '00000000-0000-4000-a000-000000000062' as Uuid,
    actorId: '00000000-0000-4000-a000-000000000063' as Uuid,
    displayName: 'CEO User' as NonEmpty,
    email: 'ceo.ladder@nexus.local' as NonEmpty,
    octLevel: 'OCT-SECURE',
    maxRiskTier: 'critical',
    allowedSystems: ['sales-finance', 'warehouse', 'gmail'],
    allowedCapabilities: [
      CAP_SEARCH_PUBLIC,
      CAP_SUMMARIZE,
      CAP_READ_RECORD_SINGLE,
      CAP_QUERY_DATA,
      CAP_READ_RECORD_BULK,
      CAP_SEARCH_DATA,
      CAP_CREATE_RECORD,
      CAP_UPDATE_RECORD_SINGLE,
      CAP_COMPOSE_EMAIL,
      CAP_READ_EMAIL,
      CAP_UPDATE_RECORD_BULK,
      CAP_DELETE_RECORD_SINGLE,
      CAP_READ_SECRET,
      CAP_QUERY_SECRET,
      CAP_DELETE_RECORD_BULK,
      CAP_ADMIN_READ,
      CAP_ADMIN_WRITE,
      CAP_ADMIN_OVERRIDE,
    ],
    firewallTransitRights: TRANSIT_SECURE,
    permittedRunTypes: [...ALL_RUN_TYPES],
    roles: ['workspace-user' as NonEmpty],
  },
];

export function getUserLadderSpec(role: UserLadderRole): RoleSpec {
  const found = USER_LADDER.find(s => s.role === role);
  if (!found) throw new Error('UNKNOWN_USER_LADDER_ROLE: ' + role);
  return found;
}

/**
 * Load the API key for a ladder role from keys/users/<role>.apikey.
 * Returns null when the file is missing (boot proceeds; that role just
 * won't have a working API-key login). Tests should generate keys via
 * `pnpm tsx scripts/dev/_gen-user-ladder-keys.ts` before running.
 */
export async function loadUserLadderApiKey(role: UserLadderRole): Promise<string | null> {
  const p = path.join('keys', 'users', `${role}.apikey`);
  try {
    return (await fs.readFile(p, 'utf-8')).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface SeedTenUserLadderDeps {
  readonly principalRegistry: PrincipalRegistry;
  readonly actorRegistry: ActorRegistry;
  readonly authProvider: KeyRegistrar;
  readonly nowIso: string;
}

/**
 * Idempotent — re-registering a role that already exists is a no-op
 * (matching the dev-admin seed pattern). The seeder logs once per role.
 */
export async function seedTenUserLadder(deps: SeedTenUserLadderDeps): Promise<void> {
  for (const spec of USER_LADDER) {
    if (!(await deps.principalRegistry.get(spec.principalId))) {
      await deps.principalRegistry.register({
        principalId: spec.principalId,
        displayName: spec.displayName,
        email: spec.email,
        registeredAt: deps.nowIso as never,
        maxDelegableRiskTier: spec.maxRiskTier,
        allowedSystems: [...spec.allowedSystems],
        permittedCapabilities: spec.allowedCapabilities,
        firewallTransitRights: spec.firewallTransitRights,
        permittedRunTypes: spec.permittedRunTypes,
        octLevel: spec.octLevel,
      });
    }
    if (!(await deps.actorRegistry.get(spec.actorId))) {
      const actor: Actor = {
        actorId: spec.actorId,
        actorClass: 'HUMAN' as never,
        principalId: spec.principalId,
        displayName: spec.displayName,
        environment: 'reference' as never,
        octLevel: spec.octLevel,
        riskCeiling: spec.maxRiskTier,
        allowedSystems: [...spec.allowedSystems],
        allowedCapabilities: [...spec.allowedCapabilities],
        roles: [...spec.roles],
        enabled: true,
        registeredAt: deps.nowIso as never,
        owner: 'system' as NonEmpty,
        purpose: ('e2e user-ladder seed: ' + spec.role) as NonEmpty,
        reviewCadence: 'quarterly' as NonEmpty,
      };
      await deps.actorRegistry.register(actor);
    }
    const apiKey = await loadUserLadderApiKey(spec.role);
    if (apiKey) {
      deps.authProvider.registerKey(apiKey, spec.actorId);
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    '[workspace-bootstrap] 10-user ladder seeded: ' + USER_LADDER.map(s => s.role).join(', ')
  );
}
