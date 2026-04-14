/**
 * Approval packager — spec §13.9.3-5 helpers used by Gate 05
 */
import type { AgentAction, ResourceTarget, RiskTier, DataClass, NonEmpty } from '../types/index.js';
import { addSeconds } from '../utils/time.js';
import { newUuid, truncate } from '../utils/helpers.js';
import type { ExecutionGrantTemplate, PipelineContext, ApprovalRequest } from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';
import type { KeyPair } from '../crypto/key-manager.js';

export function buildActionSummaryText(action: AgentAction): string {
  const verb   = action.resolvedVerb ?? action.rawVerb;
  const target = action.resolvedTarget
    ? `${action.resolvedTarget.system}/${action.resolvedTarget.resourceType}`
    : action.rawTarget;
  const scope  = action.resolvedTarget?.resourceScope ?? 'single';
  const ext    = action.resolvedTarget?.externalFacing ? ' (external)' : '';
  return `${verb} ${target} [${scope}]${ext}`;
}

export function computeEstimatedImpact(
  riskTier:    RiskTier,
  dataClasses: DataClass[],
  target:      ResourceTarget
): NonEmpty {
  const parts: string[] = [`${riskTier.toUpperCase()} risk`];
  if (target.externalFacing) parts.push('external-facing');
  if (target.resourceScope === 'bulk' || target.resourceScope === 'collection') parts.push('bulk operation');
  if (dataClasses.length > 0) parts.push(`data: ${[...dataClasses].sort().join(', ')}`);
  return parts.join(' | ');
}

export async function buildSignedApprovalRequest(
  action:   AgentAction,
  template: ExecutionGrantTemplate,
  context:  PipelineContext,
  diff:     string | null,
  controlPlaneKey: KeyPair
): Promise<ApprovalRequest> {
  const issuedAt  = new Date().toISOString();
  // SOLVE-005: expiresAt = addSeconds(issuedAt, approvalConfig.timeoutSeconds) — invariant
  const expiresAt = addSeconds(issuedAt, template.approvalConfig!.timeoutSeconds);

  const body: Omit<ApprovalRequest, 'signature'> = {
    approvalId:           newUuid(),
    actionId:             action.actionId,
    templateId:           template.templateId,
    issuedAt,
    expiresAt,
    actionSummary:        truncate(buildActionSummaryText(action), 300),
    contextSummary:       truncate(action.intent.objectiveSummary, 500),
    proposedTarget:       action.resolvedTarget!,
    diff,
    estimatedImpact:      computeEstimatedImpact(action.resolvedRiskTier!, action.resolvedDataClasses, action.resolvedTarget!),
    principalDisplayName: context.principal.displayName,
    actorDisplayName:     context.actor.displayName,
    riskTier:             action.resolvedRiskTier!,
    dataClasses:          action.resolvedDataClasses,
    modelConfidence:      action.intent.modelConfidence,
    riskNote:             action.intent.riskNote,
  };

  const signature = await sign(canonicalize(body), controlPlaneKey);
  return { ...body, signature };
}
