/**
 * Workspace Manifest Loader — AMEND-spec §4.2
 *
 * File: packages/core/src/manifest/workspace/workspace-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loads, verifies, and validates the signed workspace manifest at startup.
 * Returns an array of enabled workspace manifest records for factory
 * instantiation and socket registration.
 *
 * Steps:
 *   1-3. File read + YAML parse + Ed25519 signature verify (via loadSignedManifest)
 *   4.   Schema validation (WorkspaceManifestBodySchema)
 *   5.   Per-entry validation:
 *        - workspaceSocketId uniqueness within manifest
 *        - workspaceType registered in WorkspaceFactoryRegistry (§3.13)
 *        - entryMode must be 'governed_only' in governed runtime mode
 *   6.   At-least-one-enabled invariant (fail closed)
 *
 * Note: returnEndpointId cross-reference validation happens at Step 18
 * (cross-domain collision / cross-reference check), NOT at loader time.
 *
 * Fail-closed: any validation failure throws; dependent subsystem does not start.
 *
 * Import-law:
 *   MUST NOT import from packages/vanguard, packages/interfaces,
 *   packages/adapters, or plugin implementations.
 */
import type { WorkspaceFactoryRegistry, WorkspaceManifestRecord, NonEmpty } from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import {
  WorkspaceManifestBodySchema,
  type WorkspaceManifestEntry,
} from './workspace-manifest-schema.js';

export interface LoadWorkspaceManifestOptions {
  /** Path to the signed workspace manifest YAML */
  manifestPath: string;
  /** Control-plane public key for signature verification (base64url Ed25519) */
  controlPlanePublicKey: string;
  /** Factory registry — must be populated before calling this (§3.13 law) */
  factoryRegistry: WorkspaceFactoryRegistry;
}

// AMEND-nexus-planner-chat-tier-v0-2-0.md §3.5 — pure validation extracted
// from the loader so the cross-field rules can be unit-tested without
// disk I/O or signature verification. The loader calls this after
// loadSignedManifest returns the parsed body.

export function validateWorkspaceManifestBody(
  body: { workspaces: WorkspaceManifestEntry[] },
  factoryRegistry: WorkspaceFactoryRegistry
): WorkspaceManifestRecord[] {
  const seenIds = new Set<string>();
  const records: WorkspaceManifestRecord[] = [];

  for (const entry of body.workspaces) {
    // workspaceSocketId uniqueness within manifest — checked for ALL entries
    // including disabled, so manifest never contains ambiguous duplicate IDs
    if (seenIds.has(entry.workspaceSocketId)) {
      throw new Error(
        `workspace manifest: duplicate workspaceSocketId '${entry.workspaceSocketId}'`
      );
    }
    seenIds.add(entry.workspaceSocketId);

    // Disabled entries: skip remaining validation, emit notice
    if (!entry.enabled) {
      console.info(`[workspace-manifest] disabled workspace: ${entry.workspaceSocketId} (skipped)`);
      continue;
    }

    // AMEND-nexus-planner-chat-tier-v0-2-0.md §3.5 — when entryMode is
    // 'free_chat' the capabilities shape is constrained and
    // configuration.defaultChatAgentId must be a non-empty string. Chat
    // is single-node so planReview must be false; chat returns text so
    // finalDisplay must be true; chat has no file uploads in V1 so
    // fileSpace must be false; chat needs the prompt textarea so
    // promptEntry must be true. The actor-registry-level checks
    // (defaultChatAgentId points to an actor with synthesize capability
    // and the actor's octLevel !== 'secure') are enforced by ci:gate
    // CHAT-TIER-01 at fixture level, not by this loader, because the
    // workspace manifest loader runs before the actor registry is
    // available in the bootstrap sequence.
    if (entry.entryMode === 'free_chat') {
      if (entry.capabilities.planReview !== false) {
        throw new Error(
          `workspace manifest: free_chat workspace '${entry.workspaceSocketId}' must have capabilities.planReview === false (chat is single-node, nothing to review)`
        );
      }
      if (entry.capabilities.promptEntry !== true) {
        throw new Error(
          `workspace manifest: free_chat workspace '${entry.workspaceSocketId}' must have capabilities.promptEntry === true (chat needs the textarea)`
        );
      }
      if (entry.capabilities.fileSpace !== false) {
        throw new Error(
          `workspace manifest: free_chat workspace '${entry.workspaceSocketId}' must have capabilities.fileSpace === false (V1 chat has no file uploads)`
        );
      }
      if (entry.capabilities.finalDisplay !== true) {
        throw new Error(
          `workspace manifest: free_chat workspace '${entry.workspaceSocketId}' must have capabilities.finalDisplay === true (chat returns text the user reads)`
        );
      }
      const defaultChatAgentId = entry.configuration['defaultChatAgentId'];
      if (typeof defaultChatAgentId !== 'string' || defaultChatAgentId.length === 0) {
        throw new Error(
          `workspace manifest: free_chat workspace '${entry.workspaceSocketId}' must have configuration.defaultChatAgentId as a non-empty string`
        );
      }
    }

    // workspaceType registered in factory registry (§3.13 factory law)
    const factory = factoryRegistry.get(entry.workspaceType);
    if (factory === null) {
      throw new Error(
        `workspace manifest: workspaceType '${entry.workspaceType}' not registered` +
          ` (workspace '${entry.workspaceSocketId}')`
      );
    }

    records.push({
      workspaceSocketId: entry.workspaceSocketId as NonEmpty,
      workspaceType: entry.workspaceType as NonEmpty,
      enabled: entry.enabled,
      entryMode: entry.entryMode,
      baseUrl: entry.baseUrl as NonEmpty,
      returnEndpointId: entry.returnEndpointId as NonEmpty,
      capabilities: {
        promptEntry: entry.capabilities.promptEntry,
        planReview: entry.capabilities.planReview,
        finalDisplay: entry.capabilities.finalDisplay,
        fileSpace: entry.capabilities.fileSpace,
      },
      configuration: entry.configuration,
    });
  }

  // At-least-one-enabled invariant (§4.2: "At least one enabled workspace is required")
  if (records.length === 0) {
    throw new Error(
      'workspace manifest: zero enabled workspaces — subsystem fails closed.' +
        ' Enable at least one workspace in governed runtime mode.'
    );
  }

  return records;
}

export async function loadWorkspaceManifest(
  opts: LoadWorkspaceManifestOptions
): Promise<WorkspaceManifestRecord[]> {
  // Steps 1-4: file read, YAML parse, signature verify, schema validate
  const result = await loadSignedManifest(
    opts.manifestPath,
    WorkspaceManifestBodySchema,
    opts.controlPlanePublicKey
  );
  return validateWorkspaceManifestBody(result.body, opts.factoryRegistry);
}
