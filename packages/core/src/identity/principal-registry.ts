/**
 * Principal registry — spec §20 + F4.15 §2.1 envelope persistence.
 *
 * F4.15 added four optional fields to the Principal contract
 * (permittedCapabilities / firewallTransitRights / permittedRunTypes /
 * octLevel) used by BakedDelegationMint's per-dimension intersection.
 * This registry now round-trips all four through the SQLite store; the
 * schema migration in `packages/core/src/db/schema.ts` adds the columns
 * for existing DBs.
 */
import type Database from 'better-sqlite3';
import type {
  FirewallTransitMap,
  NonEmpty,
  OctLevel,
  Principal,
  PrincipalRegistry,
  RunTypeKind,
  Uuid,
} from '../types/index.js';

interface PrincipalRow {
  principal_id: string;
  display_name: string;
  email: string;
  registered_at: string;
  max_risk_tier: string;
  allowed_systems: string;
  permitted_capabilities: string | null;
  firewall_transit_rights: string | null;
  permitted_run_types: string | null;
  oct_level: string | null;
}

function rowToPrincipal(row: PrincipalRow): Principal {
  const base: Principal = {
    principalId: row.principal_id as Uuid,
    displayName: row.display_name as NonEmpty,
    email: row.email as NonEmpty,
    registeredAt: row.registered_at as never,
    maxDelegableRiskTier: row.max_risk_tier as never,
    allowedSystems: JSON.parse(row.allowed_systems) as string[],
  };
  if (row.permitted_capabilities !== null) {
    base.permittedCapabilities = JSON.parse(row.permitted_capabilities) as readonly NonEmpty[];
  }
  if (row.firewall_transit_rights !== null) {
    base.firewallTransitRights = JSON.parse(row.firewall_transit_rights) as FirewallTransitMap;
  }
  if (row.permitted_run_types !== null) {
    base.permittedRunTypes = JSON.parse(row.permitted_run_types) as readonly RunTypeKind[];
  }
  if (row.oct_level !== null) {
    base.octLevel = row.oct_level as OctLevel;
  }
  return base;
}

function encodeOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class SqlitePrincipalRegistry implements PrincipalRegistry {
  constructor(private readonly db: Database.Database) {}

  async get(principalId: Uuid): Promise<Principal | null> {
    const row = this.db
      .prepare('SELECT * FROM principals WHERE principal_id = ?')
      .get(principalId) as PrincipalRow | undefined;
    return row ? rowToPrincipal(row) : null;
  }

  async register(principal: Principal): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO principals
          (principal_id, display_name, email, registered_at, max_risk_tier,
           allowed_systems, permitted_capabilities, firewall_transit_rights,
           permitted_run_types, oct_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        principal.principalId,
        principal.displayName,
        principal.email,
        principal.registeredAt,
        principal.maxDelegableRiskTier,
        JSON.stringify(principal.allowedSystems),
        encodeOrNull(principal.permittedCapabilities),
        encodeOrNull(principal.firewallTransitRights),
        encodeOrNull(principal.permittedRunTypes),
        principal.octLevel ?? null
      );
    return;
  }

  async update(principalId: Uuid, principal: Principal): Promise<void> {
    this.db
      .prepare(
        `
        UPDATE principals SET
          display_name = ?,
          email = ?,
          registered_at = ?,
          max_risk_tier = ?,
          allowed_systems = ?,
          permitted_capabilities = ?,
          firewall_transit_rights = ?,
          permitted_run_types = ?,
          oct_level = ?
        WHERE principal_id = ?
      `
      )
      .run(
        principal.displayName,
        principal.email,
        principal.registeredAt,
        principal.maxDelegableRiskTier,
        JSON.stringify(principal.allowedSystems),
        encodeOrNull(principal.permittedCapabilities),
        encodeOrNull(principal.firewallTransitRights),
        encodeOrNull(principal.permittedRunTypes),
        principal.octLevel ?? null,
        principalId
      );
    return;
  }

  async list(): Promise<Principal[]> {
    const rows = this.db.prepare('SELECT * FROM principals').all() as PrincipalRow[];
    return rows.map(rowToPrincipal);
  }
}
