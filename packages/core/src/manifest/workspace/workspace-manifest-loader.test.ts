// packages/core/src/manifest/workspace/workspace-manifest-loader.test.ts
// AMEND-nexus-planner-chat-tier-v0-2-0.md §9.2 — cross-field validations
// for workspace.entryMode === 'free_chat'. Tests the pure
// `validateWorkspaceManifestBody` helper extracted in Commit 3 so the
// rules are exercised without disk I/O or signature verification.

import { describe, expect, it } from 'vitest';
import type { WorkspaceFactory, WorkspaceFactoryRegistry } from '@nexus/contracts';
import { validateWorkspaceManifestBody } from './workspace-manifest-loader.js';
import type { WorkspaceManifestEntry } from './workspace-manifest-schema.js';

const STUB_FACTORY = {} as WorkspaceFactory;

const REGISTRY: WorkspaceFactoryRegistry = {
  get: () => STUB_FACTORY,
  register: () => {
    throw new Error('register not implemented in stub');
  },
  list: () => [],
};

const CHAT_AGENT_UUID = '00000000-0000-4000-8000-0000000000d1';

function baseGovernedEntry(
  overrides: Partial<WorkspaceManifestEntry> = {}
): WorkspaceManifestEntry {
  return {
    workspaceSocketId: 'nexus-warehouse-ops',
    workspaceType: 'reference_http',
    enabled: true,
    entryMode: 'governed_only',
    baseUrl: 'http://localhost:7780/workspace',
    returnEndpointId: 'nexus-default-return',
    capabilities: {
      promptEntry: true,
      planReview: true,
      finalDisplay: true,
      fileSpace: false,
    },
    configuration: {},
    ...overrides,
  };
}

function baseChatEntry(overrides: Partial<WorkspaceManifestEntry> = {}): WorkspaceManifestEntry {
  return {
    workspaceSocketId: 'nexus-chat-default',
    workspaceType: 'chat_workspace',
    enabled: true,
    entryMode: 'free_chat',
    baseUrl: 'http://localhost:7780/chat',
    returnEndpointId: 'nexus-default-return',
    capabilities: {
      promptEntry: true,
      planReview: false,
      finalDisplay: true,
      fileSpace: false,
    },
    configuration: { defaultChatAgentId: CHAT_AGENT_UUID },
    ...overrides,
  };
}

describe('validateWorkspaceManifestBody — governed_only path (existing behavior)', () => {
  it('accepts a well-formed governed_only entry and emits a matching record', () => {
    const body = { workspaces: [baseGovernedEntry()] };
    const records = validateWorkspaceManifestBody(body, REGISTRY);
    expect(records).toHaveLength(1);
    expect(records[0]!.entryMode).toBe('governed_only');
  });

  it('rejects the body when zero entries are enabled (fail-closed invariant)', () => {
    const body = { workspaces: [baseGovernedEntry({ enabled: false })] };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/zero enabled workspaces/);
  });
});

describe('validateWorkspaceManifestBody — CHAT-LOADER cross-field rules (§3.5)', () => {
  it('CHAT-LOADER-01: free_chat workspace with valid config loads', () => {
    const body = { workspaces: [baseChatEntry()] };
    const records = validateWorkspaceManifestBody(body, REGISTRY);
    expect(records).toHaveLength(1);
    expect(records[0]!.entryMode).toBe('free_chat');
    expect(records[0]!.configuration['defaultChatAgentId']).toBe(CHAT_AGENT_UUID);
  });

  it('CHAT-LOADER-02: free_chat + planReview: true → fail-closed', () => {
    const body = {
      workspaces: [
        baseChatEntry({
          capabilities: {
            promptEntry: true,
            planReview: true,
            finalDisplay: true,
            fileSpace: false,
          },
        }),
      ],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/planReview === false/);
  });

  it('CHAT-LOADER-03: free_chat + fileSpace: true → fail-closed', () => {
    const body = {
      workspaces: [
        baseChatEntry({
          capabilities: {
            promptEntry: true,
            planReview: false,
            finalDisplay: true,
            fileSpace: true,
          },
        }),
      ],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/fileSpace === false/);
  });

  it('CHAT-LOADER-04: free_chat + missing defaultChatAgentId → fail-closed', () => {
    const body = {
      workspaces: [baseChatEntry({ configuration: {} })],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/defaultChatAgentId/);
  });

  it('CHAT-LOADER-04b: free_chat + non-string defaultChatAgentId → fail-closed', () => {
    const body = {
      workspaces: [baseChatEntry({ configuration: { defaultChatAgentId: 42 } })],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/defaultChatAgentId/);
  });

  it('CHAT-LOADER-05: free_chat + empty defaultChatAgentId → fail-closed', () => {
    const body = {
      workspaces: [baseChatEntry({ configuration: { defaultChatAgentId: '' } })],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/defaultChatAgentId/);
  });

  it('CHAT-LOADER-06: governed_only + defaultChatAgentId in configuration is ignored (only used for free_chat)', () => {
    const body = {
      workspaces: [
        baseGovernedEntry({
          configuration: { defaultChatAgentId: 'something' },
        }),
      ],
    };
    // Should not throw — the cross-field rules only apply to free_chat
    const records = validateWorkspaceManifestBody(body, REGISTRY);
    expect(records).toHaveLength(1);
    expect(records[0]!.entryMode).toBe('governed_only');
    expect(records[0]!.configuration['defaultChatAgentId']).toBe('something');
  });

  it('CHAT-LOADER-07: free_chat + promptEntry: false → fail-closed', () => {
    const body = {
      workspaces: [
        baseChatEntry({
          capabilities: {
            promptEntry: false,
            planReview: false,
            finalDisplay: true,
            fileSpace: false,
          },
        }),
      ],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/promptEntry === true/);
  });

  it('CHAT-LOADER-08: free_chat + finalDisplay: false → fail-closed', () => {
    const body = {
      workspaces: [
        baseChatEntry({
          capabilities: {
            promptEntry: true,
            planReview: false,
            finalDisplay: false,
            fileSpace: false,
          },
        }),
      ],
    };
    expect(() => validateWorkspaceManifestBody(body, REGISTRY)).toThrow(/finalDisplay === true/);
  });

  it('coexistence: governed_only and free_chat workspaces in the same manifest both load', () => {
    const body = {
      workspaces: [baseGovernedEntry(), baseChatEntry()],
    };
    const records = validateWorkspaceManifestBody(body, REGISTRY);
    expect(records).toHaveLength(2);
    expect(records.map(r => r.entryMode).sort()).toEqual(['free_chat', 'governed_only']);
  });
});
