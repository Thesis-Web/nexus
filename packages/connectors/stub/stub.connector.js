/**
 * StubConnector — spec §11.3
 * Test double for all 10 integration fixture scenarios.
 * All secrets prefixed FIXTURE_SYNTHETIC_SECRET: (spec §4.2 carve-out).
 */
import { CAPABILITY_IDS, } from '../../core/src/types/index.js';
import { assertGrantPresent, assertGrantNotExpired, setGrantSecret, } from '../../core/src/execution/grant-vault.js';
function buildActionSummaryText(action) {
    const verb = action.resolvedVerb ?? action.rawVerb;
    const target = action.resolvedTarget
        ? `${action.resolvedTarget.system}/${action.resolvedTarget.resourceType}`
        : action.rawTarget;
    return `${verb} ${target}`;
}
export class StubConnector {
    systemType = 'stub';
    connectorVersion = 'v0.1.0';
    calls = [];
    supportedCapabilities() {
        return Object.values(CAPABILITY_IDS);
    }
    canProduceDiff() {
        return true;
    }
    async produceDiff(action, _template) {
        return `[STUB DIFF] ${buildActionSummaryText(action)} — preview not available in stub`;
    }
    async redeemGrant(grant) {
        setGrantSecret(grant, `FIXTURE_SYNTHETIC_SECRET:stub-credential-${grant.grantId}`);
    }
    async execute(action, grant) {
        assertGrantPresent(grant);
        assertGrantNotExpired(grant);
        this.calls.push({ action, grantId: grant.grantId });
        return {
            grantId: grant.grantId,
            executedAt: new Date().toISOString(),
            status: 'success',
            responseCode: '200',
            durationMs: 1,
            redactedSummary: '[STUB] action executed successfully',
            errorType: null,
            errorMessage: null,
        };
    }
    getCalls() {
        return [...this.calls];
    }
    reset() {
        this.calls = [];
    }
}
