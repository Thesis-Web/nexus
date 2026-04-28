# Runbook: connect MCP wrapper v0.3

## Purpose

Connect an MCP server/tool wrapper through Nexus so tool calls are normalized, governed, evidenced, and optionally executed with bounded grants. MCP is an ingress adapter/proxy surface. It is not a governance authority.

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

- Nexus socket: adapter ingress into NXS pipeline.
- Package: `packages/adapters/mcp/src/`.
- Proxy: `packages/adapters/mcp/src/mcp-proxy.ts`.
- Normalizer: `packages/adapters/mcp/src/mcp-normalizer.ts`.
- CLI launch: `packages/interfaces/cli/src/commands/serve-mcp.ts`.

## Flow

1. MCP client sends tool call to Nexus MCP proxy.
2. `McpAdapter` normalizes raw MCP tool call into Nexus action shape.
3. `NexusMcpProxy` passes action into NXS pipeline.
4. Gates 01-07 evaluate identity, classification, delegation, policy, approval, execution, evidence.
5. Connector registry executes only after Gate 06 allows execution.
6. Evidence ledger and run ledger record outcome.
7. Proxy returns governed result to MCP caller.

## Required inputs

- Actor identity.
- Principal identity.
- Workspace/runId header or generated runId.
- Tool name and parameters.
- Target system/resource/environment.
- Delegation context when acting as an agent/subagent.

## Socket mapping

| MCP concept    | Nexus concept                        |
| -------------- | ------------------------------------ |
| tool name      | rawVerb/rawTarget source             |
| tool args      | action parameters                    |
| MCP server     | adapter ingress, not actor by itself |
| user/session   | principal/actor claims               |
| tool execution | Gate 06 connector execution          |

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/adapters/mcp/src/mcp-normalizer.test.ts --reporter=verbose
    pnpm exec vitest run packages/adapters/mcp/src/mcp-proxy.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/engine/pipeline-exception-proof.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- MCP wrapper preserves workspace-assigned runId when supplied.
- Unknown verbs fail closed or normalize only through approved lexical law.
- No MCP tool executes outside Gate 06.
- Denied actions still produce Gate 07 evidence.
- Proxy never directly imports unauthorized implementation packages.

## Do not do

- Do not treat MCP server trust as identity proof.
- Do not execute MCP tool handlers before Nexus gates.
- Do not let MCP tool schemas become policy canon.
