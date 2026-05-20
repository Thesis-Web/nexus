/**
 * Unit tests — llm-adapter-declaration validator.
 *
 * Acceptance gates F4.20 §6:
 *   LIT-04: LLM adapter declaration with targeted-system tool name
 *           (e.g., `crm_read` — verb_target shape) → rejected with
 *           `targeted_system_tool_in_adapter_declaration_forbidden`.
 *   LIT-05: LLM adapter declaration with LLM-internal tool name
 *           (e.g., `claude_code_read`, `mcp_file_search`) → accepted.
 *
 * Additional invariants:
 *   - duplicate tool names rejected
 *   - empty adapter id rejected
 *   - scope-prefix enforcement (mcp_* must be under scope 'mcp', etc.)
 *   - custom_internal scope has no required prefix but still tripwired
 *     by the targeted-system verb regex
 */
import { describe, it, expect } from 'vitest';
import type { LlmAdapterDeclaration } from '@nexus/contracts';
import {
  assertValidLlmAdapterDeclaration,
  isTargetedSystemToolName,
  validateLlmAdapterDeclaration,
} from './llm-adapter-declaration.js';

function decl(overrides: Partial<LlmAdapterDeclaration> = {}): LlmAdapterDeclaration {
  return {
    adapterId: 'test-adapter-v1' as LlmAdapterDeclaration['adapterId'],
    providerKind: 'anthropic',
    internalToolsAdvertised: [],
    ...overrides,
  };
}

describe('isTargetedSystemToolName — targeted-system verb pattern', () => {
  it.each([
    ['read_database'],
    ['write_file'],
    ['query_crm'],
    ['update_sales'],
    ['delete_record'],
    ['insert_row'],
    ['create_user'],
    ['move_file'],
    ['copy_object'],
    ['fetch_inventory'],
    ['pull_report'],
    ['push_change'],
    ['send_email'],
    ['post_message'],
    ['publish_doc'],
    ['email_invoice'],
    ['notify_team'],
    ['invoke_workflow'],
    ['READ_DATABASE'], // case insensitive
  ])('flags %s as targeted-system', name => {
    expect(isTargetedSystemToolName(name)).toBe(true);
  });

  it.each([
    ['claude_code_read'], // internal — false because prefix is claude_code_, not read_
    ['mcp_file_search'],
    ['openai_file_search'],
    ['langgraph_state_get'],
    ['reasoning_scratchpad'],
    ['thinking_step'],
    ['just_a_name'],
  ])('accepts %s as not targeted-system', name => {
    expect(isTargetedSystemToolName(name)).toBe(false);
  });
});

describe('validateLlmAdapterDeclaration — LIT-05 accept cases', () => {
  it('accepts an adapter with no internal tools', () => {
    expect(validateLlmAdapterDeclaration(decl())).toEqual([]);
  });

  it('accepts claude_code-scoped internal tool with claude_code_ prefix', () => {
    const d = decl({
      providerKind: 'anthropic',
      internalToolsAdvertised: [
        {
          toolName: 'claude_code_read' as never,
          providerScope: 'claude_code',
          description: 'Claude Code internal read' as never,
        },
      ],
    });
    expect(validateLlmAdapterDeclaration(d)).toEqual([]);
  });

  it('accepts mcp-scoped internal tool with mcp_ prefix', () => {
    const d = decl({
      providerKind: 'mcp',
      internalToolsAdvertised: [
        {
          toolName: 'mcp_file_search' as never,
          providerScope: 'mcp',
          description: 'MCP filesystem search' as never,
        },
      ],
    });
    expect(validateLlmAdapterDeclaration(d)).toEqual([]);
  });

  it('accepts a mix of valid internal tools across scopes', () => {
    const d = decl({
      internalToolsAdvertised: [
        {
          toolName: 'claude_code_read' as never,
          providerScope: 'claude_code',
          description: 'Claude Code read' as never,
        },
        {
          toolName: 'mcp_file_search' as never,
          providerScope: 'mcp',
          description: 'MCP file search' as never,
        },
        {
          toolName: 'openai_file_search' as never,
          providerScope: 'openai_internal',
          description: 'OpenAI internal file search' as never,
        },
        {
          toolName: 'reasoning_scratchpad' as never,
          providerScope: 'reasoning',
          description: 'Model-internal scratch' as never,
        },
      ],
    });
    expect(validateLlmAdapterDeclaration(d)).toEqual([]);
  });

  it('accepts custom_internal scope with no required prefix', () => {
    const d = decl({
      providerKind: 'custom',
      internalToolsAdvertised: [
        {
          toolName: 'admin_declared_internal_thing' as never,
          providerScope: 'custom_internal',
          description: 'Admin-declared internal' as never,
        },
      ],
    });
    expect(validateLlmAdapterDeclaration(d)).toEqual([]);
  });
});

describe('validateLlmAdapterDeclaration — LIT-04 reject cases', () => {
  it('rejects an adapter declaration containing a targeted-system tool name', () => {
    const d = decl({
      internalToolsAdvertised: [
        {
          toolName: 'read_database' as never,
          providerScope: 'mcp',
          description: 'should never be allowed' as never,
        },
      ],
    });
    const violations = validateLlmAdapterDeclaration(d);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      code: 'targeted_system_tool_in_adapter_declaration_forbidden',
      toolName: 'read_database',
    });
  });

  it('rejects custom_internal scope smuggling a targeted-system verb', () => {
    const d = decl({
      providerKind: 'custom',
      internalToolsAdvertised: [
        {
          toolName: 'send_email' as never,
          providerScope: 'custom_internal',
          description: 'tries to bypass via custom_internal' as never,
        },
      ],
    });
    const violations = validateLlmAdapterDeclaration(d);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('targeted_system_tool_in_adapter_declaration_forbidden');
  });

  it('rejects an mcp-scoped tool that does not start with mcp_', () => {
    const d = decl({
      providerKind: 'mcp',
      internalToolsAdvertised: [
        {
          toolName: 'something_else' as never,
          providerScope: 'mcp',
          description: 'wrong prefix' as never,
        },
      ],
    });
    const violations = validateLlmAdapterDeclaration(d);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      code: 'tool_name_scope_prefix_mismatch',
      toolName: 'something_else',
      scope: 'mcp',
      expectedPrefix: 'mcp_',
    });
  });

  it('reports both prefix mismatch and targeted-system pattern when both apply', () => {
    const d = decl({
      providerKind: 'mcp',
      internalToolsAdvertised: [
        {
          toolName: 'read_database' as never,
          providerScope: 'mcp',
          description: 'two violations' as never,
        },
      ],
    });
    const violations = validateLlmAdapterDeclaration(d);
    // Targeted-system check trips first; prefix check would also trip but
    // the validator returns at the first failure per descriptor.
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('targeted_system_tool_in_adapter_declaration_forbidden');
  });

  it('rejects duplicate tool names', () => {
    const d = decl({
      internalToolsAdvertised: [
        {
          toolName: 'mcp_file_search' as never,
          providerScope: 'mcp',
          description: 'first' as never,
        },
        {
          toolName: 'mcp_file_search' as never,
          providerScope: 'mcp',
          description: 'duplicate' as never,
        },
      ],
    });
    const violations = validateLlmAdapterDeclaration(d);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      code: 'duplicate_tool_name',
      toolName: 'mcp_file_search',
    });
  });

  it('rejects empty adapter id', () => {
    const d = decl({ adapterId: '   ' as never });
    const violations = validateLlmAdapterDeclaration(d);
    expect(violations.map(v => v.code)).toContain('empty_adapter_id');
  });
});

describe('assertValidLlmAdapterDeclaration — throw-on-violation surface', () => {
  it('throws with a violations array on invalid declarations', () => {
    const d = decl({
      internalToolsAdvertised: [
        {
          toolName: 'query_inventory' as never,
          providerScope: 'mcp',
          description: 'denied' as never,
        },
      ],
    });
    try {
      assertValidLlmAdapterDeclaration(d);
      throw new Error('expected to throw');
    } catch (err) {
      const e = err as Error & { violations?: ReadonlyArray<{ code: string }> };
      expect(e.message).toContain('LlmAdapterDeclaration invalid');
      expect(e.violations).toBeDefined();
      expect(e.violations?.[0]?.code).toBe('targeted_system_tool_in_adapter_declaration_forbidden');
    }
  });

  it('returns void on valid declarations', () => {
    expect(() => assertValidLlmAdapterDeclaration(decl())).not.toThrow();
  });
});
