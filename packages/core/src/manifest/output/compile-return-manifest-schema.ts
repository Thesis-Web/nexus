/**
 * Compile-Return Manifest Schema — AMEND-spec §4.6
 *
 * File: packages/core/src/manifest/output/compile-return-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const CompileReturnEndpointEntrySchema = z
  .object({
    returnEndpointId: NonEmptyStringSchema,
    endpointType: z.literal('http_callback'),
    enabled: z.boolean(),
    targetWorkspaceSocketId: NonEmptyStringSchema,
    url: z.string().url(),
    auth: z
      .object({
        kind: z.literal('signed_callback'),
        keyId: NonEmptyStringSchema,
      })
      .strict(),
    acceptedArtifactTypes: z.array(NonEmptyStringSchema).min(1),
    configuration: z.record(z.unknown()),
  })
  .strict();

export const CompileReturnManifestBodySchema = z
  .object({
    returnEndpoints: z.array(CompileReturnEndpointEntrySchema).min(1),
  })
  .strict();

export type CompileReturnEndpointEntry = z.infer<typeof CompileReturnEndpointEntrySchema>;
