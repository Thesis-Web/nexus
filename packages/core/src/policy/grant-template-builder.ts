/**
 * Grant template builder — spec §13.9.10 buildGrantTemplate
 * Fingerprint projection helper — spec §13.9.9 (SOLVE-003)
 *
 * MODULAR-008: Gate 04 is the sole computation point for ExecutionGrantTemplate law.
 * No connector, adapter, channel, or interface layer may supplement or override.
 */
import {
  OUTCOME_LABEL, EXPIRY_CLASS, EXPIRY_CLASS_SECONDS,
  NexusSecurityViolation, DENIAL_CODE,
  type AgentAction, type PolicyRule, type PipelineContext,
  type ExecutionGrantTemplate, type ResourceBounds,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';
import { newUuid, stripUndefined } from '../utils/helpers.js';

/**
 * Shared fingerprint projection helper — spec §13.9.9 (SOLVE-003)
 * Omits templateFingerprint and approvalLinkage by field destructuring.
 * Both buildGrantTemplate and assertTemplateIntegrity call this helper.
 * undefined values are illegal in canonicalize(); omission is correct.
 */
export function templateFingerprintPayload(
  template: Omit<ExecutionGrantTemplate, 'templateFingerprint' | 'approvalLinkage'>
): Record<string, unknown> {
  return stripUndefined({ ...template } as Record<string, unknown>);
}

export function assertTemplateIntegrity(template: ExecutionGrantTemplate): void {
  const { templateFingerprint: _, approvalLinkage: __, ...body } = template;
  const expected = sha256(canonicalize(templateFingerprintPayload(body)));
  if (expected !== template.templateFingerprint) {
    throw new NexusSecurityViolation(
      'template_fingerprint_mismatch',
      DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED
    );
  }
  if (template.approvalRequired && !template.approvalLinkage) {
    throw new NexusSecurityViolation(
      'approval_required_but_linkage_absent',
      DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED
    );
  }
}

function resolveCredentialSubjectType(
  actorClass: string,
  _system: string
): 'user_identity' | 'service_identity' | 'federated' {
  if (actorClass === 'HUMAN' || actorClass === 'HUMAN_WITH_COPILOT') return 'user_identity';
  return 'service_identity';
}

function buildScopeDescriptor(
  capabilityId: string,
  target: import('../types/index.js').ResourceTarget,
  hint: import('../types/index.js').GrantTemplateHint | null | undefined
): string {
  const base = `${capabilityId}@${target.system}:${target.resourceType}:${target.resourceScope}`;
  const ext  = (hint?.allowExternalFacing || target.externalFacing) ? ':external' : '';
  return base + ext;
}

export function buildGrantTemplate(
  action:  AgentAction,
  rule:    PolicyRule | undefined,
  context: PipelineContext
): ExecutionGrantTemplate {
  const hint        = rule?.grantHint;
  const expiryClass = hint?.expiryClass ?? EXPIRY_CLASS.ACTION_SCOPED;
  const maxExpiry   = EXPIRY_CLASS_SECONDS[expiryClass] ?? 30;

  const resourceBounds: ResourceBounds = {
    allowedResourceTypes: [action.resolvedTarget!.resourceType],
    maxRecords:           hint?.maxRecords ?? 1,
    allowBulk:            hint?.allowBulk ?? false,
    allowExternalFacing:  hint?.allowExternalFacing ?? false,
  };

  const dc = context.delegationContext!; // Gate 01 invariant
  if (!dc.allowedSystems.includes(action.resolvedTarget!.system)) {
    throw new NexusSecurityViolation(
      'grant_template_exceeds_delegation_scope',
      DENIAL_CODE.BROAD_TOKEN_BYPASS
    );
  }

  const credentialSubjectType = resolveCredentialSubjectType(
    context.actor!.actorClass, action.resolvedTarget!.system
  );
  const scopeDescriptor = buildScopeDescriptor(
    action.resolvedCapability!, action.resolvedTarget!, hint
  );
  const approvalRequired =
    rule?.outcome === OUTCOME_LABEL.REQUIRE_APPROVAL ||
    rule?.outcome === OUTCOME_LABEL.ESCALATE;

  const templateBody = {
    templateId:            newUuid(),
    actionId:              action.actionId,
    computedAt:            new Date().toISOString(),
    capabilityId:          action.resolvedCapability!,
    scopeDescriptor,
    credentialSubjectType,
    resourceBounds,
    environmentBound:      action.resolvedTarget!.environment,
    expiryClass,
    maxExpirySeconds:      maxExpiry,
    approvalRequired,
    approvalConfig:        rule?.approvalConfig ?? null,
  };

  // Fingerprint via shared helper — approvalLinkage omitted because it's not in templateBody
  const templateFingerprint = sha256(canonicalize(templateFingerprintPayload(templateBody)));

  // approvalLinkage starts null; set by Gate 05 after approval
  return { ...templateBody, approvalLinkage: null, templateFingerprint };
}
