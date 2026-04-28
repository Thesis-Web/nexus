# Runbook: connect Ollama v0.3

## Purpose

Connect an on-prem Ollama runtime as a Nexus-governed NVG model endpoint. Ollama is not a governance component. It is a model-serving target behind NVG routing, endpoint manifest validation, OCT ceiling enforcement, and routing provenance logging.

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

- Nexus socket: `ModelTransportAdapter` + signed endpoint manifest.
- Plane: NVG model-egress control.
- Runtime package area: `packages/vanguard/src/transport/`.
- Config surface: `config/nvg/endpoints.v1.yaml`.
- Expected adapter: `OllamaChatV1Adapter` from `@nexus/vanguard`.

## Flow

1. Operator runs Ollama on localhost, LAN, or an internal server.
2. Operator pulls/loads a local model such as Llama, Qwen, Gemma, Mistral, Phi, or DeepSeek.
3. Operator adds an endpoint entry to `config/nvg/endpoints.v1.yaml`.
4. Operator signs the manifest using Nexus manifest signing flow.
5. Bootstrap loads the signed endpoint manifest.
6. `TierRegistry` receives the endpoint.
7. `NvgServiceImpl.classifyAndRoute()` chooses a tier after classification, policy, and OCT ceiling enforcement.
8. `model-router.ts` invokes Ollama through the adapter.
9. RPT writes outbound and inbound trail entries.

## Endpoint manifest shape

Use the existing endpoint manifest schema. The values below are illustrative; match the current schema names in `endpoint-manifest-schema.ts` before committing.

    endpoints:
      - endpointId: ep-ollama-local-llama
        enabled: true
        tier: on_prem_general
        adapterId: ollama_chat_v1
        baseUrl: http://127.0.0.1:11434
        model: llama3.2:1b
        timeoutMs: 30000
        healthy: true
        adapterConfig:
          apiPath: /api/chat

## OCT / routing guidance

- `on_prem_sensitive`: local model for PII, proprietary, or OCT-sensitive data.
- `on_prem_general`: local non-sensitive workloads.
- Do not route sensitive labels to frontier tiers unless policy explicitly permits it.
- Do not let Ollama decide classification, OCT, or policy.

## Targeted validation

Run only the focused checks first:

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/vanguard/src/transport/registry.test.ts --reporter=verbose
    pnpm exec vitest run packages/vanguard/src/nvg-classify-and-route.test.ts --reporter=verbose
    pnpm exec vitest run packages/vanguard/src/nvg-scenarios.integration.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Endpoint is present in signed `config/nvg/endpoints.v1.yaml`.
- Bootstrap logs endpoint manifest load and TierRegistry registration.
- NVG routes to the on-prem tier when labels/policy require it.
- RPT outbound entry contains runId and selected tier.
- RPT inbound entry exists after model return.
- Failed endpoint calls mark endpoint health through the registry path when WIRE-003 is closed.

## Do not do

- Do not call Ollama directly from NXS gates.
- Do not hardcode Ollama URL inside `nvg-service.ts`.
- Do not put Ollama API keys or hostnames in ledger records.
- Do not treat the model name as an actor identity.
