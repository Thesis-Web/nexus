/**
 * Grant minter — spec §13.7 mintGrant
 */
import {
  type AgentAction, type ExecutionGrantTemplate,
  type ApprovalRequest, type ExecutionGrant, type CredentialSubject,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';
import type { KeyPair } from '../crypto/key-manager.js';
import { newUuid } from '../utils/helpers.js';
import { addSeconds } from '../utils/time.js';

function resolveCredentialSubject(
  template: ExecutionGrantTemplate,
  action: AgentAction
): CredentialSubject {
  const subjectType = template.credentialSubjectType as CredentialSubject['subjectType'];
  return {
    subjectId:   subjectType === 'user_identity' ? action.actorId : `svc:${action.actorId}`,
    subjectType,
    system:      action.resolvedTarget!.system,
  };
}

export async function mintGrant(
  action:        AgentAction,
  template:      ExecutionGrantTemplate,
  approval:      ApprovalRequest | null,
  controlPlaneKey: KeyPair
): Promise<ExecutionGrant> {
  const now       = new Date().toISOString();
  const expiresAt = addSeconds(now, template.maxExpirySeconds);
  const credSub   = resolveCredentialSubject(template, action);

  const grantBody = {
    grantId:           newUuid(),
    actionId:          action.actionId,
    templateId:        template.templateId,
    approvalId:        approval?.approvalId ?? null,
    mintedAt:          now,
    expiresAt,
    capabilityId:      template.capabilityId,
    scopeDescriptor:   template.scopeDescriptor,
    credentialSubject: credSub,
    resourceBounds:    template.resourceBounds,
    environmentBound:  template.environmentBound,
  };

  const signature = await sign(canonicalize(grantBody), controlPlaneKey);
  return { ...grantBody, signature };
}
