/**
 * Orchestrator Manifest Schema — AMEND-spec §4.3
 * AMEND-spec-nexus-orch §4.2 — Extended manifest fields
 *
 * File: packages/core/src/manifest/orchestrators/orchestrator-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const OrchestratorManifestEntrySchema = z
  .object({
    orchestratorSocketId: NonEmptyStringSchema,
    orchestratorType: NonEmptyStringSchema,
    enabled: z.boolean(),
    orchestratorActorId: NonEmptyStringSchema,
    plannerMode: z.enum(['deterministic_first', 'policy_template', 'llm_assisted']),
    maxSplitDepth: z.number().int().min(0),
    planCheckbackDefault: z.boolean(),
    secureMode: z
      .object({
        octSecureDefault: z.literal('single_agent_no_helper'),
        allowSecureMultiAgentOnlyBySignedPolicy: z.boolean(),
      })
      .strict(),
    retryPolicy: z
      .object({
        transientAutoRetryCount: z.number().int().min(0),
      })
      .strict(),
    timeouts: z
      .object({
        systemActionMs: z.number().int().min(1),
        modelCallMs: z.number().int().min(1),
      })
      .strict(),
    outputSlotPolicy: z.enum(['strict_declared_slots', 'advisory_declared_slots', 'open_slots']),
    configuration: z.record(z.unknown()),
    // ── AMEND-spec-nexus-orch §4.2 — planner/amendment/partial fields ──
    plannerType: NonEmptyStringSchema,
    plannerVersion: NonEmptyStringSchema,
    plannerConfiguration: z.record(z.unknown()),
    planAmendment: z
      .object({
        enabled: z.boolean(),
        maxAmendments: z.number().int().min(0),
        requiresCheckback: z.boolean(),
      })
      .strict(),
    partialCompletion: z
      .object({
        enabled: z.boolean(),
        minRequiredCompletedNodes: z.number().int().min(0),
        compileOnPartial: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const OrchestratorManifestBodySchema = z
  .object({
    orchestrators: z.array(OrchestratorManifestEntrySchema).min(1),
  })
  .strict();

export type OrchestratorManifestEntry = z.infer<typeof OrchestratorManifestEntrySchema>;
