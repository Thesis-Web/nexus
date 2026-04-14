import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';
import { newUuid } from '../utils/helpers.js';
import { addSeconds } from '../utils/time.js';
function resolveCredentialSubject(template, action) {
    const subjectType = template.credentialSubjectType;
    return {
        subjectId: subjectType === 'user_identity' ? action.actorId : `svc:${action.actorId}`,
        subjectType,
        system: action.resolvedTarget.system,
    };
}
export async function mintGrant(action, template, approval, controlPlaneKey) {
    const now = new Date().toISOString();
    const expiresAt = addSeconds(now, template.maxExpirySeconds);
    const credSub = resolveCredentialSubject(template, action);
    const grantBody = {
        grantId: newUuid(),
        actionId: action.actionId,
        templateId: template.templateId,
        approvalId: approval?.approvalId ?? null,
        mintedAt: now,
        expiresAt,
        capabilityId: template.capabilityId,
        scopeDescriptor: template.scopeDescriptor,
        credentialSubject: credSub,
        resourceBounds: template.resourceBounds,
        environmentBound: template.environmentBound,
    };
    const signature = await sign(canonicalize(grantBody), controlPlaneKey);
    return { ...grantBody, signature };
}
