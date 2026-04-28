# Runbook: connect OpenAI-compatible endpoint v0.3

## Purpose

Connect any OpenAI-compatible model server or gateway as a Nexus-governed NVG endpoint. This covers LocalAI, llama.cpp server, vLLM OpenAI server, LiteLLM proxy, OpenRouter-like gateways, and vendor endpoints that expose compatible chat/completions semantics.

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
- Plane: NVG.
- Adapter path: `packages/vanguard/src/transport/adapters/openai-chat-v1.ts` or equivalent current adapter.
- Config: `config/nvg/endpoints.v1.yaml`.

## Flow

1. External runtime exposes an OpenAI-compatible HTTP endpoint.
2. Operator stores credentials outside repo, normally in env or secret source.
3. Operator adds endpoint manifest entry with adapterId for OpenAI-compatible chat.
4. Manifest is signed.
5. Bootstrap loads endpoint and registers it to the tier registry.
6. NVG selects endpoint through classification, routing policy, OCT ceiling, health, and fallback rules.
7. Adapter sends the normalized model request.
8. Inbound response is logged and normalized before returning to caller.

## Endpoint examples

LocalAI:

    endpointId: ep-localai-qwen
    tier: on_prem_general
    adapterId: openai_chat_v1
    baseUrl: http://127.0.0.1:8080/v1
    model: qwen2.5

vLLM OpenAI server:

    endpointId: ep-vllm-gemma
    tier: on_prem_sensitive
    adapterId: openai_chat_v1
    baseUrl: http://10.0.0.25:8000/v1
    model: google/gemma-2-9b-it

LiteLLM proxy:

    endpointId: ep-litellm-router
    tier: frontier_general
    adapterId: openai_chat_v1
    baseUrl: https://litellm.internal.example/v1
    model: routed-by-litellm

## Secret handling

- Put tokens in environment or configured `SecretSource`.
- Endpoint manifests may reference secret names but must not store secret values.
- RPT should record endpointId/tier/model metadata, not token material.

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/vanguard/src/transport/registry.test.ts --reporter=verbose
    pnpm exec vitest run packages/vanguard/src/nvg-scenarios.integration.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Adapter ID exists and is registered during bootstrap.
- Endpoint manifest validates and signature verifies.
- Endpoint appears in TierRegistry.
- Health/fallback behavior does not bypass OCT or routing policy.
- Inbound response goes through NVG return path, not directly back to workspace.

## Do not do

- Do not make LiteLLM/OpenRouter the governance layer.
- Do not bypass NVG because an endpoint is OpenAI-compatible.
- Do not store provider keys in fixtures committed to repo.
