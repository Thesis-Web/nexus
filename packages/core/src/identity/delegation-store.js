function rowToDelegation(row) {
    return {
        delegationId: row.delegation_id,
        principalId: row.principal_id,
        actorId: row.actor_id,
        parentDelegationId: row.parent_delegation_id,
        chainDepth: row.chain_depth,
        maxChainDepth: row.max_chain_depth,
        allowedSystems: JSON.parse(row.allowed_systems),
        allowedCapabilities: JSON.parse(row.allowed_capabilities),
        forbiddenCapabilities: JSON.parse(row.forbidden_capabilities),
        maxRiskTier: row.max_risk_tier,
        allowDownstreamPropagation: row.allow_downstream_propagation === 1,
        environment: row.environment,
        mintedAt: row.minted_at,
        expiresAt: row.expires_at,
        mintedBy: row.minted_by,
        signature: row.signature,
    };
}
export class SqliteDelegationStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async getById(delegationId) {
        const row = this.db
            .prepare('SELECT * FROM delegations WHERE delegation_id = ?')
            .get(delegationId);
        return row ? rowToDelegation(row) : null;
    }
    async save(dc) {
        this.db
            .prepare(`
      INSERT OR REPLACE INTO delegations
        (delegation_id, principal_id, actor_id, parent_delegation_id, chain_depth,
         max_chain_depth, allowed_systems, allowed_capabilities, forbidden_capabilities,
         max_risk_tier, allow_downstream_propagation, environment,
         minted_at, expires_at, minted_by, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
            .run(dc.delegationId, dc.principalId, dc.actorId, dc.parentDelegationId, dc.chainDepth, dc.maxChainDepth, JSON.stringify(dc.allowedSystems), JSON.stringify(dc.allowedCapabilities), JSON.stringify(dc.forbiddenCapabilities), dc.maxRiskTier, dc.allowDownstreamPropagation ? 1 : 0, dc.environment, dc.mintedAt, dc.expiresAt, dc.mintedBy, dc.signature);
    }
    async listForActor(actorId) {
        const rows = this.db
            .prepare('SELECT * FROM delegations WHERE actor_id = ?')
            .all(actorId);
        return rows.map(rowToDelegation);
    }
}
/** nextSequence: engine-assigned monotonic counter per delegationId. (CONTRA-403) */
export function nextSequence(db, delegationId) {
    const row = db
        .prepare('SELECT last_sequence FROM delegation_sequences WHERE delegation_id = ?')
        .get(delegationId);
    if (!row) {
        db.prepare('INSERT INTO delegation_sequences (delegation_id, last_sequence) VALUES (?, 1)').run(delegationId);
        return 1;
    }
    const next = row.last_sequence + 1;
    db.prepare('UPDATE delegation_sequences SET last_sequence = ? WHERE delegation_id = ?').run(next, delegationId);
    return next;
}
