/**
 * Approval Channel Manifest Schema — spec §32a.2.3
 *
 * File: packages/core/src/manifest/channels/channel-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * Zod schemas for validating the signed approval-channel manifest body.
 * Used by the channel manifest loader via loadSignedManifest().
 *
 * Body shape per blueprint §14.6.2:
 *   { channelId, channelType, configuration, enabled }
 *
 * channelType is an open governed string — validated against
 * ApprovalChannelFactoryRegistry at loader time (§12.3.48 behavior law).
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const ApprovalChannelManifestEntrySchema = z
  .object({
    channelId: NonEmptyStringSchema,
    channelType: NonEmptyStringSchema,
    configuration: z.record(z.unknown()),
    enabled: z.boolean(),
  })
  .strict();

export const ApprovalChannelManifestBodySchema = z
  .object({
    channels: z.array(ApprovalChannelManifestEntrySchema).min(0),
  })
  .strict();

export type ApprovalChannelManifestEntry = z.infer<typeof ApprovalChannelManifestEntrySchema>;
