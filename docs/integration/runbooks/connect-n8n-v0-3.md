# Runbook: connect n8n v0.3

## Purpose

Connect n8n workflows as governed callers or governed action targets. n8n should orchestrate business workflow, while Nexus governs AI/model egress and delegated action execution.

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

Two supported modes:

1. n8n as caller/orchestrator into Nexus API or MCP wrapper.
2. n8n as external action target behind a connector/webhook.

Do not embed Nexus policy inside n8n workflow nodes.

## Mode A: n8n calls Nexus

Flow:

1. n8n trigger starts business workflow.
2. n8n obtains enterprise identity/session context.
3. n8n sends governed request to Nexus API or MCP proxy.
4. Nexus evaluates gates and returns governed result.
5. n8n continues workflow based on Nexus result.

Required request metadata:

- principalId or token-derived identity
- actorId for automation/agent actor
- runId
- environment
- action/tool intent
- target system/resource

## Mode B: Nexus calls n8n

Flow:

1. Nexus Gate 06 decides a workflow action is allowed.
2. Connector invokes a specific n8n webhook or workflow endpoint.
3. n8n performs business automation.
4. Connector returns result metadata to Nexus.
5. Gate 07 records execution result.

Connector manifest example:

    connectors:
      - connectorId: n8n-workflow-main
        connectorType: webhook
        enabled: true
        allowedSystems:
          - n8n
        configuration:
          baseUrl: https://n8n.internal/webhook
          secretRef: N8N_WEBHOOK_TOKEN
          allowedWorkflows:
            - sales-followup-create-task
            - inventory-reorder-draft

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/adapters/mcp/src/mcp-proxy.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/06-execution.gate.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/integration/scenarios.integration.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- n8n cannot call connectors directly without Nexus if action is governed.
- n8n workflow identity maps to actor/principal/OCT context.
- n8n webhook tokens stay in secret source, not manifests or ledgers.
- Evidence contains workflow name/id metadata but no secrets.

## Do not do

- Do not make n8n the approval authority unless connected as an approval channel and signed by canon.
- Do not put broad n8n admin tokens into fixture files.
- Do not treat workflow success as Nexus authorization.
