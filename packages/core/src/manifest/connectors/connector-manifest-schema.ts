/**
 * Connector Manifest Schema — spec §32a.2.2
 *
 * File: packages/core/src/manifest/connectors/connector-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * Zod schemas for validating the signed connector manifest body.
 * Used by the connector manifest loader via loadSignedManifest().
 *
 * Body shape per blueprint §14.6.2:
 *   { connectorId, connectorType, allowedSystems, configuration, enabled }
 *
 * connectorType is an open governed string — validated against
 * ConnectorFactoryRegistry at loader time (§12.3.48 behavior law).
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';
import { DATA_CLASS_ORDER } from '@nexus/contracts';

const NonEmptyStringSchema = z.string().min(1);

const DataClassSchema = z
  .string()
  .min(1)
  .refine(v => DATA_CLASS_ORDER.includes(v), {
    message: `dataClass must be one of: ${DATA_CLASS_ORDER.join(', ')}`,
  });

export const ConnectorManifestEntrySchema = z
  .object({
    connectorId: NonEmptyStringSchema,
    connectorType: NonEmptyStringSchema,
    allowedSystems: z.array(NonEmptyStringSchema).min(1),
    dataClass: DataClassSchema,
    configuration: z.record(z.unknown()),
    enabled: z.boolean(),
  })
  .strict();

export const ConnectorManifestBodySchema = z
  .object({
    connectors: z.array(ConnectorManifestEntrySchema).min(0),
  })
  .strict();

export type ConnectorManifestEntry = z.infer<typeof ConnectorManifestEntrySchema>;
