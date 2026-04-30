/**
 * Compiler Manifest Schema — AMEND-spec §4.5
 *
 * File: packages/core/src/manifest/compile/compiler-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * artifactSigning uses a discriminated union on 'kind':
 *   - control_plane: reference deterministic compiler signing
 *   - actor_registry_key: non-reference compiler signing
 *
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

const ArtifactSigningSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('control_plane') }).strict(),
  z
    .object({
      kind: z.literal('actor_registry_key'),
      keyId: NonEmptyStringSchema,
    })
    .strict(),
]);

export const CompilerManifestEntrySchema = z
  .object({
    compilerSocketId: NonEmptyStringSchema,
    compilerType: NonEmptyStringSchema,
    enabled: z.boolean(),
    actorRegistration: z.enum(['exempt_reference_deterministic_renderer', 'required']),
    compilerActorId: z.union([NonEmptyStringSchema, z.null()]),
    octMode: z.literal('OCT-COMPILE'),
    allowedModes: z
      .array(z.enum(['deterministic_render', 'on_prem_synthesis', 'frontier_synthesis']))
      .min(1),
    readsFromMailboxId: NonEmptyStringSchema,
    outputContractVersion: z.literal('v1'),
    artifactSigning: ArtifactSigningSchema,
    configuration: z.record(z.unknown()),
  })
  .strict();

export const CompilerManifestBodySchema = z
  .object({
    compilers: z.array(CompilerManifestEntrySchema).min(1),
  })
  .strict();

export type CompilerManifestEntry = z.infer<typeof CompilerManifestEntrySchema>;
