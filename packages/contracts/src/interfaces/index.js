// packages/contracts/src/interfaces/index.ts
// Spec: nexus-engineering-spec-v1-8-26.md §12.3, §10.2, §14.1
// Layer 2 — all interface contracts. Imports from types and constants only.
// ─── §12.3.36 Error Classes ───
export class ApprovalDecisionError extends Error {
    constructor(message) {
        super(message);
    }
}
// ─── §15 Error Classes ───
export class NexusError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NexusError';
    }
}
export class DelegationError extends NexusError {
    constructor(message) {
        super(message);
    }
}
export class DelegationChainIntegrityError extends NexusError {
    constructor(missingId) {
        super(`Delegation chain broken: parent ${missingId} not found in store`);
    }
}
export class NexusSecurityViolation extends NexusError {
    denialCode;
    constructor(denialCode, message) {
        super(message);
        this.denialCode = denialCode;
    }
}
export class PolicySignatureError extends NexusError {
    constructor(message) {
        super(message);
        this.name = 'PolicySignatureError';
    }
}
export class ChainErrorClass extends NexusError {
    denialCode;
    constructor(message, denialCode) {
        super(message);
        this.name = 'ChainError';
        this.denialCode = denialCode;
    }
}
