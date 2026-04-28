# Runbook: connect OpenFGA v0.3

## Purpose

Connect OpenFGA as an external authorization knowledge source without moving Nexus governance into OpenFGA. OpenFGA can answer relationship/entitlement questions; Nexus still decides runtime action allowance through gates, policy, OCT, grants, approvals, and evidence.

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

- Nexus socket: policy/authorization helper through a connector or policy data source.
- Plane: NXS policy support, not final governance authority.
- Likely packages: connector surface under `packages/connectors/` or a future policy adapter.
- Manifest domain: connector manifest if queried as an external system.

## Flow

1. Identity gate resolves principal/actor.
2. Policy gate evaluates Nexus signed policy.
3. If policy needs relationship context, Nexus calls an OpenFGA connector.
4. OpenFGA returns allow/deny relationship facts.
5. Nexus policy gate interprets the fact under signed Nexus policy.
6. Evidence records the policy rule and relevant decision metadata.

## Connector manifest example

    connectors:
      - connectorId: openfga-main
        connectorType: openfga
        enabled: true
        allowedSystems:
          - openfga
        configuration:
          apiUrl: https://openfga.internal
          storeId: company-main
          authorizationModelId: model-current
          secretRef: OPENFGA_API_TOKEN

## Decision boundary

OpenFGA may answer:

- Does principal X have relation Y to object Z?
- Is actor X a member of group Y?
- Is service account X allowed to reference resource Z?

Nexus must still answer:

- Is this action allowed under the signed Nexus policy?
- Is the actor OCT permitted for the risk/data class?
- Does the actor have a bounded grant?
- Is approval required?
- What evidence must be written?

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run tests/manifest/connector-manifest-signature.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/04-policy.gate.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Connector manifest is signed.
- OpenFGA connector cannot execute actions directly.
- OpenFGA response is metadata to Nexus policy, not a replacement decision.
- Ledger records policy decision under Nexus rule IDs.

## Do not do

- Do not copy OpenFGA authorization models into Nexus canon.
- Do not let OpenFGA bypass Gate 03 delegation or Gate 06 execution grant.
- Do not store OpenFGA API tokens in manifest bodies.
