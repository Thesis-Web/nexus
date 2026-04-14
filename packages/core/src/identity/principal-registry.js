function rowToPrincipal(row) {
    return {
        principalId: row.principal_id,
        displayName: row.display_name,
        email: row.email,
        registeredAt: row.registered_at,
        maxDelegableRiskTier: row.max_risk_tier,
        allowedSystems: JSON.parse(row.allowed_systems),
    };
}
export class PrincipalRegistry {
    db;
    constructor(db) {
        this.db = db;
    }
    async get(principalId) {
        const row = this.db
            .prepare('SELECT * FROM principals WHERE principal_id = ?')
            .get(principalId);
        return row ? rowToPrincipal(row) : null;
    }
    async register(principal) {
        this.db
            .prepare(`
        INSERT INTO principals
          (principal_id, display_name, email, registered_at, max_risk_tier, allowed_systems)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
            .run(principal.principalId, principal.displayName, principal.email, principal.registeredAt, principal.maxDelegableRiskTier, JSON.stringify(principal.allowedSystems));
        return principal;
    }
    async list() {
        const rows = this.db.prepare('SELECT * FROM principals').all();
        return rows.map(rowToPrincipal);
    }
}
