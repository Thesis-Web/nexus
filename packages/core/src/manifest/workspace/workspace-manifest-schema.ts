/**
 * Workspace Manifest Schema — AMEND-spec §4.2
 *
 * File: packages/core/src/manifest/workspace/workspace-manifest-schema.ts
 * Layer 1 — imports zod (approved external lib).
 *
 * Zod schemas for validating the signed workspace manifest body.
 * Used by the workspace manifest loader via loadSignedManifest().
 *
 * Body shape per blueprint §7.1 / spec §4.2:
 *   { workspaces: [{ workspaceSocketId, workspaceType, enabled, entryMode,
 *     baseUrl, returnEndpointId, capabilities, configuration }] }
 *
 * workspaceType is an open governed string — validated against
 * WorkspaceFactoryRegistry at loader time (§3.13 factory law).
 * .strict() on all schemas rejects unknown fields.
 */
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const WorkspaceManifestEntrySchema = z
  .object({
    workspaceSocketId: NonEmptyStringSchema,
    workspaceType: NonEmptyStringSchema,
    enabled: z.boolean(),
    // AMEND-nexus-planner-chat-tier-v0-2-0.md §2.4 — entryMode widens to
    // 'governed_only' | 'free_chat'. Cross-field validation (capabilities
    // shape, defaultChatAgentId) lives in the loader because it depends
    // on `free_chat` being selected.
    entryMode: z.enum(['governed_only', 'free_chat']),
    baseUrl: z.string().url(),
    returnEndpointId: NonEmptyStringSchema,
    capabilities: z
      .object({
        promptEntry: z.boolean(),
        planReview: z.boolean(),
        finalDisplay: z.boolean(),
        fileSpace: z.boolean(),
      })
      .strict(),
    configuration: z.record(z.unknown()),
  })
  .strict();

export const WorkspaceManifestBodySchema = z
  .object({
    workspaces: z.array(WorkspaceManifestEntrySchema).min(1),
  })
  .strict();

export type WorkspaceManifestEntry = z.infer<typeof WorkspaceManifestEntrySchema>;
