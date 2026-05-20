/**
 * @nexus/runtime-utils / llm-adapter-declaration
 *
 * Validation for `LlmAdapterDeclaration` per F4.20 / Q6 / Hard Laws #5/#7.
 *
 * Every LLM adapter ships a declaration listing the LLM-internal tools it
 * advertises to its LLM during inference (Claude Code MCP, OpenAI
 * file_search, Langgraph internal state, model-internal reasoning
 * scratchpads, etc.). Internal tools never touch the customer's targeted
 * internal systems — they live entirely within the LLM runtime / adapter.
 *
 * Targeted-system tools (database reads, CRM writes, file moves, emails,
 * etc.) MUST go through the planner-authored nxs_dispatch node path
 * (Spec F4.7). LLMs cannot initiate them via post-inference tool calls;
 * any model `tool_calls` field caught by NVG return-precheck is treated as
 * text and logged as `unsolicited_model_tool_call` (Spec F4.20 §4.1).
 *
 * This validator enforces the boundary at adapter declaration time. The
 * static CI gate (F4.19 GOV-02) plus the runtime validator together make
 * "advertise a targeted-system tool to the LLM" structurally impossible.
 */
import type {
  InternalToolDescriptor,
  InternalToolScope,
  LlmAdapterDeclaration,
} from '@nexus/contracts';

/**
 * Reason codes returned when a declaration is rejected. Surfaced verbatim
 * to admin UIs and audit logs.
 */
export type LlmAdapterDeclarationViolation =
  /** Tool name does not begin with the scope-required prefix. */
  | {
      readonly code: 'tool_name_scope_prefix_mismatch';
      readonly toolName: string;
      readonly scope: InternalToolScope;
      readonly expectedPrefix: string;
    }
  /** Tool name matches a known targeted-system verb pattern (read_, write_, query_, etc.). */
  | {
      readonly code: 'targeted_system_tool_in_adapter_declaration_forbidden';
      readonly toolName: string;
    }
  /** Two descriptors share the same tool name. */
  | { readonly code: 'duplicate_tool_name'; readonly toolName: string }
  /** Adapter id is empty / blank. */
  | { readonly code: 'empty_adapter_id' };

/**
 * Per-scope required tool-name prefix. The mapping is intentionally narrow:
 * each scope is owned by exactly one provider family, and the prefix is
 * how reviewers eyeball that a descriptor belongs in this scope (no
 * `mcp_*` tool in the `langgraph` bucket, etc.).
 *
 * `custom_internal` carries no enforced prefix because it is the escape
 * hatch for admin-declared internals; the targeted-system verb regex
 * still applies so the escape hatch cannot smuggle a CRUD-on-target tool.
 */
const SCOPE_REQUIRED_PREFIX: Readonly<Record<InternalToolScope, string | null>> = {
  claude_code: 'claude_code_',
  mcp: 'mcp_',
  openai_internal: 'openai_',
  langgraph: 'langgraph_',
  reasoning: 'reasoning_',
  custom_internal: null,
};

/**
 * Pattern matching verb_target tool names where the verb is a CRUD /
 * messaging verb that, by Nexus convention, only the planner-authored
 * nxs_dispatch path may emit. Any such name in an adapter declaration is
 * rejected regardless of providerScope (defense-in-depth against an
 * admin claiming `custom_internal` for `read_crm`).
 *
 * The verb list mirrors §28.1 lexical-normalizer canonical action verbs
 * extended with the SaaS-egress verbs commonly seen in CRM/email/file
 * connectors (send_, post_, publish_).
 */
const TARGETED_SYSTEM_VERB_PATTERN =
  /^(read|write|query|update|delete|insert|create|move|copy|fetch|pull|push|send|post|publish|email|notify|invoke)_/i;

/**
 * Validate a single LlmAdapterDeclaration. Returns the list of violations
 * (empty array if the declaration is acceptable). Callers that want a
 * throw-on-error shape can use {@link assertValidLlmAdapterDeclaration}.
 */
export function validateLlmAdapterDeclaration(
  declaration: LlmAdapterDeclaration
): ReadonlyArray<LlmAdapterDeclarationViolation> {
  const violations: LlmAdapterDeclarationViolation[] = [];

  if (typeof declaration.adapterId !== 'string' || declaration.adapterId.trim().length === 0) {
    violations.push({ code: 'empty_adapter_id' });
  }

  const seen = new Set<string>();
  for (const descriptor of declaration.internalToolsAdvertised) {
    const v = checkInternalToolDescriptor(descriptor);
    if (v !== null) violations.push(v);
    if (seen.has(descriptor.toolName)) {
      violations.push({ code: 'duplicate_tool_name', toolName: descriptor.toolName });
    }
    seen.add(descriptor.toolName);
  }

  return violations;
}

/**
 * Throw if the declaration carries any violation. The thrown Error has a
 * `.violations` property carrying the full list — admin UIs can render
 * each one.
 */
export function assertValidLlmAdapterDeclaration(declaration: LlmAdapterDeclaration): void {
  const violations = validateLlmAdapterDeclaration(declaration);
  if (violations.length > 0) {
    const err = new Error(
      `LlmAdapterDeclaration invalid (adapterId=${declaration.adapterId}): ${violations
        .map(v => v.code)
        .join(', ')}`
    ) as Error & { violations: ReadonlyArray<LlmAdapterDeclarationViolation> };
    err.violations = violations;
    throw err;
  }
}

/**
 * Test whether a tool name shape matches a targeted-system verb pattern.
 * Exported for unit tests; the validator itself uses it via
 * {@link checkInternalToolDescriptor}.
 */
export function isTargetedSystemToolName(toolName: string): boolean {
  return TARGETED_SYSTEM_VERB_PATTERN.test(toolName);
}

function checkInternalToolDescriptor(
  descriptor: InternalToolDescriptor
): LlmAdapterDeclarationViolation | null {
  if (isTargetedSystemToolName(descriptor.toolName)) {
    return {
      code: 'targeted_system_tool_in_adapter_declaration_forbidden',
      toolName: descriptor.toolName,
    };
  }
  const requiredPrefix = SCOPE_REQUIRED_PREFIX[descriptor.providerScope];
  if (requiredPrefix !== null && !descriptor.toolName.startsWith(requiredPrefix)) {
    return {
      code: 'tool_name_scope_prefix_mismatch',
      toolName: descriptor.toolName,
      scope: descriptor.providerScope,
      expectedPrefix: requiredPrefix,
    };
  }
  return null;
}
