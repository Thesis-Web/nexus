# Nexus external integration roadmap v0.3

## Mission

Nexus should fit inside enterprise environments by owning governed sockets, not by replacing every enterprise system.

## Integration order

1. Model endpoints: Ollama and OpenAI-compatible endpoint.
2. Identity: Keycloak/OIDC reference enterprise path.
3. Tool ingress: MCP wrapper.
4. Business automation: n8n and Temporal.
5. Authorization support: OpenFGA as policy data source, not governance owner.
6. Developer assistants: Cursor/Copilot/Claude Code/Codex through wrappers.
7. Observability: export Nexus evidence/trails to search/dashboards.
8. Compiler/egress: assemble approved output without changing evidence.

## Architecture rule

- IAM answers who entered.
- RBAC/relationship systems provide enterprise context.
- NVG decides model egress/routing.
- NXS decides action execution.
- Evidence/RPT/run ledger remain Nexus truth.
- External tools are plugged into sockets, not granted authority over Nexus policy.

## Local model coverage

Local model families such as Llama, Qwen, Gemma, Mistral/Mixtral, Phi, and DeepSeek should be treated as model payloads behind serving runtimes. Serving runtimes include Ollama, llama.cpp server, vLLM, LocalAI, and TGI. Nexus routes to endpoint IDs and tiers; it does not govern by model-brand special case.

## First proof stack

- Keycloak for OIDC identity.
- Ollama with Llama/Qwen/Gemma for on-prem endpoint proof.
- OpenAI-compatible adapter for vLLM/LocalAI/LiteLLM proof.
- MCP wrapper for tool-call ingress.
- n8n or Temporal for business workflow.
- OpenSearch/Grafana for read-only observability export.

## Done means

Each integration has:

- concrete Nexus socket;
- repo path anchors;
- signed manifest/config surface where applicable;
- validation tests;
- do-not rules preserving governance authority.
