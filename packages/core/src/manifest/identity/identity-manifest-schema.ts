/**
 * Identity Provider Manifest Schema — spec §32a.2.1
 *
 * File: packages/core/src/manifest/identity/identity-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * Zod schemas for validating the signed identity-provider manifest body.
 * Used by the identity manifest loader via loadSignedManifest().
 *
 * Body shape per blueprint §14.6.2:
 *   { providerId, providerType, configuration, enabled }
 *
 * providerType is an open governed string — validated against
 * IdentityProviderFactoryRegistry at loader time (§12.3.48 behavior law).
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const IdentityProviderManifestEntrySchema = z
  .object({
    providerId: NonEmptyStringSchema,
    providerType: NonEmptyStringSchema,
    configuration: z.record(z.unknown()),
    enabled: z.boolean(),
  })
  .strict();

export const IdentityProviderManifestBodySchema = z
  .object({
    providers: z.array(IdentityProviderManifestEntrySchema).min(0),
  })
  .strict();

export type IdentityProviderManifestEntry = z.infer<typeof IdentityProviderManifestEntrySchema>;
