/**
 * StubConnector — spec §11.3
 * Test double for all 10 integration fixture scenarios.
 * All secrets prefixed FIXTURE_SYNTHETIC_SECRET: (spec §4.2 carve-out).
 */
import {
  CAPABILITY_IDS,
  type Connector, type AgentAction, type ExecutionGrant, type ExecutionResult,
  type ExecutionGrantTemplate,
} from '../../core/src/types/index.js';
import {
  assertGrantPresent, assertGrantNotExpired, setGrantSecret,
} from '../../core/src/execution/grant-vault.js';

function buildActionSummaryText(action: AgentAction): string {
  const verb   = action.resolvedVerb ?? action.rawVerb;
  const target = action.resolvedTarget
    ? `${action.resolvedTarget.system}/${action.resolvedTarget.resourceType}`
    : action.rawTarget;
  return `${verb} ${target}`;
}

export class StubConnector implements Connector {
  readonly systemType       = 'stub';
  readonly connectorVersion = 'v0.1.0';

  private calls: Array<{ action: AgentAction; grantId: string }> = [];

  supportedCapabilities(): string[] {
    return Object.values(CAPABILITY_IDS);
  }

  canProduceDiff(): boolean { return true; }

  async produceDiff(action: AgentAction, _template: ExecutionGrantTemplate): Promise<string> {
    return `[STUB DIFF] ${buildActionSummaryText(action)} — preview not available in stub`;
  }

  async redeemGrant(grant: ExecutionGrant): Promise<void> {
    setGrantSecret(grant, `FIXTURE_SYNTHETIC_SECRET:stub-credential-${grant.grantId}`);
  }

  async execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult> {
    assertGrantPresent(grant);
    assertGrantNotExpired(grant);
    this.calls.push({ action, grantId: grant.grantId });
    return {
      grantId:         grant.grantId,
      executedAt:      new Date().toISOString(),
      status:         'success',
      responseCode:    '200',
      durationMs:      1,
      redactedSummary: '[STUB] action executed successfully',
      errorType:       null,
      errorMessage:    null,
    };
  }

  getCalls(): Array<{ action: AgentAction; grantId: string }> { return [...this.calls]; }
  reset(): void { this.calls = []; }
}
