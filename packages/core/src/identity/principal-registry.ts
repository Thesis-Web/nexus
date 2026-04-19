/**
 * Principal registry — spec §20
 */
import type Database from 'better-sqlite3';
import type { Principal, Uuid, PrincipalRegistry } from '../types/index.js';

interface PrincipalRow {
  principal_id: string;
  display_name: string;
  email: string;
  registered_at: string;
  max_risk_tier: string;
  allowed_systems: string;
}

function rowToPrincipal(row: PrincipalRow): Principal {
  return {
    principalId: row.principal_id,
    displayName: row.display_name,
    email: row.email,
    registeredAt: row.registered_at,
    maxDelegableRiskTier: row.max_risk_tier,
    allowedSystems: JSON.parse(row.allowed_systems) as string[],
  };
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
          (principal_id, display_name, email, registered_at, max_risk_tier, allowed_systems)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        principal.principalId,
        principal.displayName,
        principal.email,
        principal.registeredAt,
        principal.maxDelegableRiskTier,
        JSON.stringify(principal.allowedSystems)
      );
    return;
  }

  async list(): Promise<Principal[]> {
    const rows = this.db.prepare('SELECT * FROM principals').all() as PrincipalRow[];
    return rows.map(rowToPrincipal);
  }
}
