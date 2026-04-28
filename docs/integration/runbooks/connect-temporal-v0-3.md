# Runbook: connect Temporal v0.3

## Purpose

Connect Temporal as durable workflow orchestration around Nexus-governed calls. Temporal can schedule, retry, and coordinate work; Nexus remains the governance authority for model routing and delegated action execution.

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

Supported modes:

- Temporal workflow calls Nexus as a governed client.
- Nexus emits/executes a connector action that starts a Temporal workflow.
- Temporal activity workers call Nexus before performing sensitive actions.

## Flow: Temporal calls Nexus

1. Workflow receives business event.
2. Workflow/activity builds Nexus action envelope.
3. Workflow sends request to Nexus API/MCP wrapper with runId/correlationId.
4. Nexus gates evaluate and write evidence.
5. Workflow stores Nexus result in workflow history.
6. Workflow proceeds only on allowed result.

## Flow: Nexus starts Temporal

1. Gate 06 approves a workflow-start action.
2. Temporal connector calls Temporal frontend/client.
3. Connector returns workflowId/runId metadata.
4. Gate 07 records execution result.

## Correlation mapping

| Temporal      | Nexus                                  |
| ------------- | -------------------------------------- |
| workflowId    | external correlation metadata          |
| runId         | keep separate unless explicitly mapped |
| activityId    | action metadata                        |
| workflow type | target workflow/resource type          |
| namespace     | environment / system scope             |

## Connector manifest example

    connectors:
      - connectorId: temporal-main
        connectorType: temporal
        enabled: true
        allowedSystems:
          - temporal
        configuration:
          address: temporal.internal:7233
          namespace: company-main
          secretRef: TEMPORAL_CLIENT_CERT
          allowedWorkflowTypes:
            - InventoryReorderWorkflow
            - SalesFollowupWorkflow

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run tests/manifest/connector-manifest-signature.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/06-execution.gate.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/engine/pipeline-exception-proof.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Temporal retries do not create duplicate unauthorized executions.
- Replay/idempotency is handled through Nexus runId/actionId/delegationSequence.
- Temporal secrets/certs are not in ledgers.
- Workflow start is governed as an action, not treated as transport plumbing.

## Do not do

- Do not let Temporal worker perform sensitive action before Nexus Gate 06.
- Do not equate Temporal workflow history with Nexus evidence ledger.
- Do not let retries bypass replay detection.
