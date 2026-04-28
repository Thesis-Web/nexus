# Nexus Integration Sockets v0.1

## Core rule

Nexus should not own the ecosystem. Nexus should own the governed sockets.

## Socket map

| Socket                     | Nexus owner surface                             | External systems                                                 | Runtime rule                                                         |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Identity / IAM / RBAC      | `IdentityProviderInterface` + identity manifest | Entra ID, Okta, Keycloak, Authentik, Zitadel                     | Upstream authenticates. Nexus consumes claims.                       |
| Fine-grained authorization | policy import / claims projection               | OpenFGA, OPA, Casbin                                             | External policy may inform claims/profile. Nexus gates still decide. |
| Local/on-prem model        | NVG endpoint manifest + transport adapter       | Ollama, llama.cpp, vLLM, TGI                                     | NVG routes. Adapter only transports.                                 |
| Frontier model API         | NVG endpoint manifest + transport adapter       | OpenAI, Anthropic, Gemini, Grok/xAI, Perplexity, Mistral, Cohere | No provider is special-cased in core.                                |
| OpenAI-compatible gateway  | NVG endpoint manifest                           | LiteLLM, OpenRouter, vLLM OpenAI server, llama.cpp server        | Gateway is endpoint, not authority.                                  |
| Agent/workflow runner      | Workspace/orchestrator adapter + NXS/NVG calls  | n8n, Temporal, LangGraph, CrewAI, AutoGen, Dify, Flowise         | Runner calls Nexus. Nexus does not become runner.                    |
| MCP wrapper                | MCP adapter                                     | Cursor/Claude Desktop/custom MCP clients                         | MCP normalizes inbound action; NXS gates execution.                  |
| Dev coding tools           | IDE/plugin/workspace adapter                    | Cursor, Copilot, Claude Code, Codex CLI, Continue, Aider         | Treat as work surfaces or actors.                                    |
| Compiler/final response    | compile actor + evidence/run ledger             | internal compiler, future compiler service                       | Compiler has actor/OCT and cannot execute system actions.            |
| Observability              | ledger export/readers                           | OpenSearch, Loki, Grafana, SIEM                                  | Observability consumes signed evidence; it does not decide.          |

## Plug-in invariant

Every integration must answer:

1. Which socket does it attach to?
2. Which manifest/config declares it?
3. Which actor/principal/OCT owns it?
4. Which audit stream records it?
5. Which gate can deny it?
6. Which package owns the adapter?
7. Which package must not import it?
