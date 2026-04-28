# Runbook: connect Keycloak v0.3

## Purpose

Connect Keycloak as an upstream identity provider for Nexus. Keycloak authenticates users/services and issues OIDC/JWT claims. Nexus consumes those claims through the identity-provider socket and maps them into principal, actor, role/capability ceiling, environment, and OCT-related governance context.

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

- Nexus socket: `IdentityProviderInterface` / identity provider factory.
- Plane: upstream identity into NXS/NVG runtime governance.
- Manifest domain: identity provider manifest.
- Config target: `config/identity/providers.v1.yaml`.
- Reference package: `packages/identity-ref/` is starter/dev only, not enterprise IAM.

## Flow

1. Keycloak authenticates user/service via OIDC.
2. Client presents token to the Nexus-facing workspace/API/orchestrator surface.
3. Identity adapter validates issuer, audience, expiry, signature, and required claims.
4. Adapter maps Keycloak claims to Nexus identity context.
5. Nexus gates use mapped actor/principal/OCT/capability ceilings.
6. Nexus writes evidence under Nexus runId/actor/principal fields.

## Claim mapping

Suggested mapping:

| Keycloak/OIDC source                    | Nexus field                                 |
| --------------------------------------- | ------------------------------------------- |
| `sub`                                   | `principalId` or external subject reference |
| `preferred_username` / `email`          | display metadata only                       |
| realm/client roles                      | role assignments / allowed operations       |
| groups                                  | actor group or environment membership       |
| custom claim `nexus_actor_class`        | actorClass                                  |
| custom claim `nexus_environment`        | environment                                 |
| custom claim `nexus_capability_ceiling` | maxDelegableRiskTier / capability ceiling   |

OCT assignment should remain a signed Nexus operator action unless canon explicitly delegates OCT source authority to the IdP.

## Identity manifest shape

Example only; align with `identity-manifest-schema.ts`.

    providers:
      - providerId: keycloak-main
        providerType: oidc_keycloak
        enabled: true
        configuration:
          issuer: https://keycloak.example/realms/company
          audience: nexus
          jwksUri: https://keycloak.example/realms/company/protocol/openid-connect/certs
          claimMap: keycloak-default

## Required validation

- Verify issuer.
- Verify audience.
- Verify token expiry.
- Verify signature using JWKS or pinned public key.
- Reject missing subject/principal.
- Reject unknown actor class.
- Reject unassigned OCT when runtime requires OCT.

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run tests/manifest/identity-manifest-signature.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/01-identity.gate.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/02-classification.gate.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Identity manifest is signed and validates.
- Provider factory is registered before manifest load.
- Bad token fails closed.
- Missing OCT fails where required.
- Evidence records identify Nexus principal/actor, not just raw Keycloak token values.

## Do not do

- Do not make Nexus an OAuth authorization server.
- Do not let Keycloak decide Nexus action grants.
- Do not store raw bearer tokens in ledger/RPT.
- Do not use groups as a replacement for signed OCT assignment unless canon changes.
