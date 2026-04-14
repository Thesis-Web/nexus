/**
 * scripts/gen-schemas.ts
 * Generates schemas/*.schema.json from governed Nexus types.
 * Spec: nexus-engineering-spec-v0-4-6.md §3.3, §8.2
 *
 * CONTRA-AUDIT-005 fix (2026-04-14):
 *   "JSON schema export from Zod schemas" — §3.3 runtime validation law.
 *   schemas/*.schema.json must be present in the repo layout (§8.2).
 *
 * Run: pnpm exec tsx scripts/gen-schemas.ts
 * Also executed as part of turbo build via package.json "build" script.
 */

import * as fs from 'fs';
import * as path from 'path';

// Inline minimal JSON Schema definitions matching the governed types.
// These are derived from the spec §10.3.x interface definitions.
// When Zod schemas are wired in types/index.ts, replace these with
// zodToJsonSchema() exports. Until then, these serve as the governed
// runtime contract schema export.

const SCHEMAS_DIR = 'schemas';

interface SchemaEntry {
  filename: string;
  description: string;
  schema: Record<string, unknown>;
}

const SCHEMAS: SchemaEntry[] = [
  {
    filename: 'agent-action.schema.json',
    description: 'AgentAction — §10.3.5',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/agent-action',
      title: 'AgentAction',
      description: 'Spec §10.3.5 — agent action as normalized at adapter ingress',
      type: 'object',
      required: [
        'actionId',
        'receivedAt',
        'protocol',
        'adapterVersion',
        'actorId',
        'principalId',
        'sessionId',
        'delegationId',
        'delegationSequence',
        'tool',
        'rawVerb',
        'rawTarget',
        'intent',
        'resolvedVerb',
        'resolvedCapability',
        'resolvedTarget',
        'resolvedDataClasses',
        'resolvedRiskTier',
      ],
      properties: {
        actionId: { type: 'string', format: 'uuid' },
        receivedAt: { type: 'string', format: 'date-time' },
        protocol: { type: 'string', minLength: 1 },
        adapterVersion: { type: 'string', minLength: 1 },
        actorId: { type: 'string', format: 'uuid' },
        principalId: { type: 'string', format: 'uuid' },
        sessionId: { type: 'string', format: 'uuid' },
        delegationId: { type: 'string', format: 'uuid' },
        delegationSequence: { type: 'integer', minimum: 1 },
        tool: { type: 'string', minLength: 1 },
        rawVerb: { type: 'string', minLength: 1 },
        rawTarget: { type: 'string', minLength: 1 },
        resolvedVerb: { type: ['string', 'null'] },
        resolvedCapability: { type: ['string', 'null'] },
        resolvedTarget: { $ref: '#/definitions/ResourceTarget' },
        resolvedDataClasses: { type: 'array', items: { type: 'string' } },
        resolvedRiskTier: { type: ['string', 'null'] },
      },
      definitions: {
        ResourceTarget: {
          type: ['object', 'null'],
          required: ['system', 'resourceType', 'resourceScope', 'environment', 'externalFacing'],
          properties: {
            system: { type: 'string', minLength: 1 },
            resourceType: { type: 'string', minLength: 1 },
            resourceScope: { enum: ['single', 'bulk', 'collection', 'system'] },
            environment: { type: 'string' },
            externalFacing: { type: 'boolean' },
          },
        },
      },
      additionalProperties: false,
    },
  },

  {
    filename: 'evidence-record.schema.json',
    description: 'EvidenceRecord — §10.3.20',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/evidence-record',
      title: 'EvidenceRecord',
      description: 'Spec §10.3.20 — tamper-evident signed hash-chained evidence record',
      type: 'object',
      required: [
        'recordId',
        'actionId',
        'sessionId',
        'ledgerSequence',
        'actionSummary',
        'intentEvidence',
        'delegationContextSnapshot',
        'gateDecisions',
        'policyRuleId',
        'policyOutcome',
        'approvalRequest',
        'approvalResponse',
        'grantMetadata',
        'executionResult',
        'finalOutcome',
        'threatEvents',
        'compilerView',
        'previousHash',
        'recordHash',
        'signature',
      ],
      properties: {
        recordId: { type: 'string', format: 'uuid' },
        actionId: { type: 'string', format: 'uuid' },
        sessionId: { type: 'string', format: 'uuid' },
        ledgerSequence: { type: 'integer', minimum: 1 },
        previousHash: { type: 'string', minLength: 64, maxLength: 64 },
        recordHash: { type: 'string', minLength: 64, maxLength: 64 },
        signature: { type: 'string', minLength: 1 },
        finalOutcome: {
          enum: [
            'executed',
            'denied_identity',
            'denied_classification',
            'denied_delegation',
            'denied_policy',
            'denied_approval',
            'denied_timeout',
            'denied_threat',
            'error',
          ],
        },
        // CCV must be present — §31.7 CCV inside hash law
        compilerView: {
          type: 'object',
          description: 'CompilerComparisonView §14.1 — inside signed body',
        },
        gateDecisions: { type: 'array' },
        threatEvents: { type: 'array' },
        approvalRequest: { type: ['object', 'null'] },
        approvalResponse: { type: ['object', 'null'] },
        grantMetadata: { type: ['object', 'null'] },
        executionResult: { type: ['object', 'null'] },
        actionSummary: {
          type: 'object',
          required: ['actorClass', 'actorEnvironment', 'delegationSequence'],
          properties: {
            actorClass: { type: 'string', minLength: 1 },
            actorEnvironment: { type: 'string', minLength: 1 },
            delegationSequence: { type: 'integer', minimum: 1 },
          },
          // secretValue is prohibited in evidence — §18 redaction law
          not: {
            required: ['secretValue'],
          },
        },
      },
      additionalProperties: true,
    },
  },

  {
    filename: 'delegation-context.schema.json',
    description: 'DelegationContext — §10.3.3',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/delegation-context',
      title: 'DelegationContext',
      description: 'Spec §10.3.3',
      type: 'object',
      required: [
        'delegationId',
        'principalId',
        'actorId',
        'parentDelegationId',
        'chainDepth',
        'maxChainDepth',
        'allowedSystems',
        'allowedCapabilities',
        'forbiddenCapabilities',
        'maxRiskTier',
        'allowDownstreamPropagation',
        'environment',
        'mintedAt',
        'expiresAt',
        'mintedBy',
        'signature',
      ],
      properties: {
        delegationId: { type: 'string', format: 'uuid' },
        principalId: { type: 'string', format: 'uuid' },
        actorId: { type: 'string', format: 'uuid' },
        parentDelegationId: { type: ['string', 'null'] },
        chainDepth: { type: 'integer', minimum: 0 },
        maxChainDepth: { type: 'integer', minimum: 0 },
        allowedSystems: { type: 'array', items: { type: 'string' } },
        allowedCapabilities: { type: 'array', items: { type: 'string' } },
        forbiddenCapabilities: { type: 'array', items: { type: 'string' } },
        maxRiskTier: { type: 'string' },
        allowDownstreamPropagation: { type: 'boolean' },
        environment: { type: 'string' },
        mintedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        mintedBy: { type: 'string', minLength: 1 },
        signature: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
  },

  {
    filename: 'execution-grant.schema.json',
    description: 'ExecutionGrant — §10.3.13',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/execution-grant',
      title: 'ExecutionGrant',
      description: 'Spec §10.3.13 — note: secretValue is NOT on this schema; WeakMap only',
      type: 'object',
      required: [
        'grantId',
        'actionId',
        'templateId',
        'approvalId',
        'mintedAt',
        'expiresAt',
        'capabilityId',
        'scopeDescriptor',
        'credentialSubject',
        'resourceBounds',
        'environmentBound',
        'signature',
      ],
      properties: {
        grantId: { type: 'string', format: 'uuid' },
        actionId: { type: 'string', format: 'uuid' },
        templateId: { type: 'string', format: 'uuid' },
        approvalId: { type: ['string', 'null'] },
        mintedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        capabilityId: { type: 'string', minLength: 1 },
        scopeDescriptor: { type: 'string', minLength: 1 },
        environmentBound: { type: 'string' },
        signature: { type: 'string', minLength: 1 },
        // secretValue explicitly excluded — §17.5 grant vault law
      },
      // secretValue must NEVER appear on this type — §10.3.13
      not: { required: ['secretValue'] },
      additionalProperties: true,
    },
  },

  {
    filename: 'compiler-comparison-view.schema.json',
    description: 'CompilerComparisonView — §14.1',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/compiler-comparison-view',
      title: 'CompilerComparisonView',
      description: 'Spec §14.1 — must live inside signed EvidenceRecord body',
      type: 'object',
      required: [
        'meta',
        'identity',
        'delegation',
        'classification',
        'policyAndApproval',
        'authorityAndExecution',
        'result',
      ],
      properties: {
        meta: {
          type: 'object',
          required: [
            'blueprintVersion',
            'runtimeContractVersion',
            'capabilityTaxonomyVersion',
            'comparisonInputVersion',
            'normalizedActionHash',
            'policyBundleHash',
          ],
          properties: {
            blueprintVersion: { type: 'string' },
            runtimeContractVersion: { type: 'string' },
            capabilityTaxonomyVersion: { type: 'string' },
            comparisonInputVersion: { type: 'string' },
            normalizedActionHash: { type: 'string', minLength: 64, maxLength: 64 },
            policyBundleHash: { type: 'string', minLength: 64, maxLength: 64 },
          },
        },
        identity: {
          type: 'object',
          required: ['actorId', 'actorClass', 'principalId', 'environment'],
        },
        delegation: {
          type: 'object',
          required: ['delegationContextId', 'chainDepth', 'chainHash', 'maxRiskTier'],
        },
        classification: {
          type: 'object',
          required: ['capabilityId', 'actionVerb', 'dataClasses', 'riskTier'],
        },
        policyAndApproval: {
          type: 'object',
          required: ['policyRuleId', 'outcomeLabel', 'approvalRequired', 'approvalDecisionLabel'],
        },
        authorityAndExecution: {
          type: 'object',
          required: [
            'executionGrantId',
            'credentialSubjectType',
            'scopeDescriptor',
            'expiryClass',
            'grantTemplateFingerprint',
          ],
        },
        result: {
          type: 'object',
          required: ['finalOutcome', 'errorCodeFamily'],
        },
      },
      additionalProperties: false,
    },
  },

  {
    filename: 'approval-request.schema.json',
    description: 'ApprovalRequest — §10.3.11',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'nexus/approval-request',
      title: 'ApprovalRequest',
      description: 'Spec §10.3.11',
      type: 'object',
      required: [
        'approvalId',
        'actionId',
        'templateId',
        'issuedAt',
        'expiresAt',
        'actionSummary',
        'contextSummary',
        'proposedTarget',
        'estimatedImpact',
        'principalDisplayName',
        'actorDisplayName',
        'riskTier',
        'dataClasses',
        'signature',
      ],
      properties: {
        approvalId: { type: 'string', format: 'uuid' },
        actionId: { type: 'string', format: 'uuid' },
        templateId: { type: 'string', format: 'uuid' },
        issuedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        actionSummary: { type: 'string', maxLength: 300 },
        contextSummary: { type: 'string', maxLength: 500 },
        diff: { type: ['string', 'null'], maxLength: 2000 },
        estimatedImpact: { type: 'string', minLength: 1 },
        principalDisplayName: { type: 'string', minLength: 1 },
        actorDisplayName: { type: 'string', minLength: 1 },
        riskTier: { type: 'string' },
        dataClasses: { type: 'array', items: { type: 'string' } },
        modelConfidence: { type: ['number', 'null'] },
        riskNote: { type: ['string', 'null'] },
        signature: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Write all schemas
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(SCHEMAS_DIR)) {
    fs.mkdirSync(SCHEMAS_DIR, { recursive: true });
  }

  let written = 0;
  for (const entry of SCHEMAS) {
    const outPath = path.join(SCHEMAS_DIR, entry.filename);
    fs.writeFileSync(outPath, JSON.stringify(entry.schema, null, 2) + '\n', 'utf-8');
    console.log(`  ✓ ${outPath} — ${entry.description}`);
    written++;
  }

  console.log(`\ngen-schemas: ${written} schema(s) written to ${SCHEMAS_DIR}/`);
}

main();
