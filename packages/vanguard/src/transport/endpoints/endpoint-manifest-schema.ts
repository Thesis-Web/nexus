/**
 * Endpoint Manifest Schema — spec §32a.2.4
 *
 * File: packages/vanguard/src/transport/endpoints/endpoint-manifest-schema.ts
 * Layer 3 — imports zod (approved external lib).
 *
 * Zod schemas for validating the signed endpoint manifest body.
 * Used by the endpoint manifest loader (§26.5) via loadSignedManifest().
 *
 * Auth schema mirrors §12.3.38 ModelEndpointAuth discriminated union.
 * .strict() on all schemas rejects unknown fields.
 * adapterConfig: open Record at this layer; per-adapter validation at Step 6.5.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

// Auth schema mirrors §12.3.38 ModelEndpointAuth discriminated union with .strict()
// branches (kind: 'none' rejects secretRef/headerName/prefix; kind: api_key | bearer
// requires secretRef + headerName, allows optional prefix).
const ModelEndpointAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.union([z.literal('api_key'), z.literal('bearer')]),
      secretRef: NonEmptyStringSchema,
      headerName: NonEmptyStringSchema,
      prefix: NonEmptyStringSchema.optional(),
    })
    .strict(),
]);

// Endpoint entry schema — one per ModelEndpoint (§12.3) record in the manifest.
// .strict() rejects unknown TOP-LEVEL fields. The adapterConfig field accepts an
// open Record<string, unknown> at this layer; per-adapter validation runs at the
// loader's Step 6.5 against the registered adapter's configSchema (§12.3.40, §26.5).
// Forbidden keys (stream, streaming, model, messages, auth, url, adapterId,
// endpointId, tier, enabled, healthy) are rejected at loader Step 6.4 BEFORE
// per-adapter schema runs.
export const EndpointManifestEntrySchema = z
  .object({
    endpointId: NonEmptyStringSchema,
    tier: NonEmptyStringSchema,
    url: z.string().url(),
    adapterId: NonEmptyStringSchema,
    modelName: NonEmptyStringSchema,
    auth: ModelEndpointAuthSchema,
    timeoutMs: z.number().int().positive().optional(),
    /**
     * NEW in r4 per audit B1.
     * Open shape at the manifest layer. Loader §26.5 Step 6.4 rejects forbidden keys;
     * Step 6.5 invokes the registered adapter's configSchema for shape validation.
     * Defaults applied at adapter invoke time per §24.5.5.
     */
    adapterConfig: z.record(z.unknown()).optional(),
    enabled: z.boolean(),
  })
  .strict();

export const EndpointManifestBodySchema = z
  .object({
    endpoints: z.array(EndpointManifestEntrySchema).min(0),
  })
  .strict();
