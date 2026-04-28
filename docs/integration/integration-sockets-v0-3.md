# Nexus integration sockets v0.3

## Core rule

External systems plug into Nexus through governed sockets. They do not become governance authorities.

## Socket inventory

| Socket                  | Primary repo anchors                                                                         | External examples                                                    | Governance owner                           |
| ----------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Identity provider       | `config/identity/providers.v1.yaml`, `packages/identity-ref/`, contracts identity interfaces | Keycloak, Authentik, Zitadel, Entra, Okta                            | Nexus consumes identity; IdP authenticates |
| Model endpoint          | `config/nvg/endpoints.v1.yaml`, `packages/vanguard/src/transport/`                           | Ollama, vLLM, llama.cpp, LocalAI, LiteLLM, OpenAI, Anthropic, Gemini | NVG                                        |
| Connector/action target | `packages/connectors/`, connector manifest                                                   | Vault, n8n, Temporal, webhooks, business systems                     | NXS Gate 06                                |
| Adapter ingress         | `packages/adapters/mcp/src/`, API routes, CLI commands                                       | MCP wrappers, IDE/workspace plugins, orchestrators                   | NXS/NVG depending path                     |
| Approval channel        | channel manifest, channel registry                                                           | CLI, Slack/Teams/email future channels                               | NXS Gate 05                                |
| Compiler/egress         | compiler boundary/run output                                                                 | report compilers, response assemblers                                | Nexus evidence + output contract           |
| Observability export    | evidence/RPT/run-ledger readers/exporters                                                    | OpenSearch, Loki, Grafana, SIEM                                      | Nexus remains source of truth              |

## Non-negotiables

- Signed manifests/config for governed surfaces.
- Actor/principal/OCT ownership before runtime trust.
- No external tool bypasses Gate 07 evidence.
- No model gateway replaces NVG routing/OCT policy.
- No IAM/RBAC provider replaces NXS action governance.
