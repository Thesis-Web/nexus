/**
 * Mailbox Manifest Schema — AMEND-spec §4.4
 *
 * File: packages/core/src/manifest/mailbox/mailbox-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const MailboxManifestEntrySchema = z
  .object({
    mailboxId: NonEmptyStringSchema,
    mailboxType: NonEmptyStringSchema,
    enabled: z.boolean(),
    required: z.boolean(),
    storageRoot: NonEmptyStringSchema,
    retentionPolicy: z
      .object({
        payloadTtlSeconds: z.number().int().min(60).max(86400),
        metadataRetention: z.literal('run_ledger'),
      })
      .strict(),
    classificationRequired: z.boolean(),
    digestRequired: z.boolean(),
    configuration: z.record(z.unknown()),
  })
  .strict();

export const MailboxManifestBodySchema = z
  .object({
    mailboxes: z.array(MailboxManifestEntrySchema).min(1),
  })
  .strict();

export type MailboxManifestEntry = z.infer<typeof MailboxManifestEntrySchema>;
