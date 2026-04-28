# Runbook: connect coding assistants v0.3

## Purpose

Connect developer-facing coding assistants such as Cursor, GitHub Copilot, Claude Code, Codex/OpenAI CLI, or similar tools through governed Nexus sockets where the assistant performs model calls, file edits, shell commands, repository operations, or agentic tasks.

## Standard Nexus contract

Every integration must preserve this boundary:

- External tool authenticates or performs its own native function.
- Nexus receives a governed request through a defined socket.
- Nexus makes governance decisions inside NVG/NXS, not inside the external tool.
- Evidence, routing provenance, and run-ledger entries remain Nexus-owned.
- External tools never bypass signed manifests, OCT ownership, policy, grants, or ledger writes.

## Repo anchors

- Composition root: `scripts/nexus-main.ts`
- Bootstrap: `scripts/nexus-bootstrap.ts`
- Contracts barrel: `packages/contracts/src/index.ts`
- Core governance engine: `packages/core/src/`
- NVG service: `packages/vanguard/src/nvg-service.ts`
- Model router: `packages/vanguard/src/router/model-router.ts`
- Transport adapters: `packages/vanguard/src/transport/adapters/`
- Endpoint manifest loader: `packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.ts`
- Endpoint manifest config: `config/nvg/endpoints.v1.yaml`
- MCP adapter/proxy: `packages/adapters/mcp/src/`
- CLI command entry points: `packages/interfaces/cli/src/commands/`
- API routes: `packages/interfaces/api/src/routes/`

## Socket classification

Coding assistants can touch multiple sockets:

| Assistant capability  | Nexus socket                                 |
| --------------------- | -------------------------------------------- |
| model request         | NVG endpoint routing                         |
| tool/function call    | NXS adapter ingress                          |
| file/repo action      | NXS connector/action governance              |
| shell command         | high-risk action through connector/gate path |
| PR/comment generation | compiler/egress path plus evidence           |

## Integration modes

### Mode A: wrapper/proxy mode

Use an MCP wrapper or local proxy so assistant tool calls enter Nexus before action execution.

Flow:

1. Assistant proposes tool call.
2. Wrapper normalizes request into Nexus action.
3. Nexus gates evaluate.
4. Allowed action executes through connector.
5. Evidence records outcome.

### Mode B: workspace plugin mode

Workspace calls Nexus API before allowing assistant actions.

Flow:

1. IDE/workspace receives assistant action request.
2. Workspace sends action envelope to Nexus.
3. Nexus returns allow/deny/approval-required.
4. Workspace enforces the response.

### Mode C: model egress routing mode

Assistant model calls are routed through NVG endpoint adapters when the deployment controls the model endpoint or proxy.

## Required metadata

- developer principal
- assistant actor ID
- actorClass: `SUPERVISED_AGENT` or `AUTONOMOUS_AGENT`
- repo/workspace environment
- requested action
- target files/systems
- risk/data labels
- runId

## Suggested governed actions

| Action                | Risk note                                          |
| --------------------- | -------------------------------------------------- |
| read repository file  | usually low/medium, depends on data labels         |
| modify source file    | requires evidence and repo target scope            |
| run tests             | medium; shell bounded to command allow-list        |
| install package       | higher risk; supply-chain policy required          |
| push branch / open PR | high; requires identity, policy, possibly approval |
| access secret         | high; requires connector grant and redaction       |

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/adapters/mcp/src/mcp-normalizer.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/03-delegation.gate.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/06-execution.gate.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Assistant has explicit actor identity.
- User/developer principal is distinct from assistant actor.
- Tool calls do not bypass Nexus gates.
- File/shell/repo actions are bounded by target and capability.
- Evidence shows who delegated what to which assistant actor.

## Do not do

- Do not identify the assistant only by vendor name.
- Do not let IDE approval UI replace Nexus approval/evidence.
- Do not give assistants broad shell access without connector policy.
- Do not route secrets into prompts without NVG/NXS approval path.
