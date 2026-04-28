# Nexus Integration Roadmap v0.1

Status: working planning doc, not canonical law.
Purpose: prevent “wiring hell” by defining how external systems plug into Nexus without changing core governance.

## Ruling

Nexus should not try to own the full ecosystem. Nexus should own the governed sockets.

The roadmap is:

1. Define stable plug-in surfaces.
2. Prove each surface with one boring reference integration.
3. Add enterprise/common adapters only after the reference path is green.
4. Keep all business systems behind manifests, adapters, and policy.

## Existing repo surfaces

Current repo already has the beginnings of the right pattern:

- `config/nvg/endpoints.v1.yaml` for model endpoints.
- `config/identity/providers.v1.yaml` for identity providers.
- `config/connectors/connectors.v1.yaml` for target-system connectors.
- `config/channels/channels.v1.yaml` for approval channels.
- `packages/runtime-utils/src/manifest/` for signed manifest load/sign helpers.
- `packages/vanguard/src/transport/` for model transport adapters.
- `packages/identity-ref/` for starter identity adapter.
- `packages/adapters/mcp/` for MCP adapter surface.
- `scripts/nexus-bootstrap.ts` as current manifest/bootstrap composition path.

This is enough to define a real integration runway.

## Integration layers

### Layer A — Identity / Auth / RBAC / IAM

Nexus consumes identity. It does not replace IAM.

Socket:

- `IdentityProviderInterface`
- signed identity manifest
- claims normalization into actor/principal/capability ceilings

Reference path:

- RIA for local bootstrap and tests.

Open-source / enterprise-fit candidates:

- Keycloak: open-source IAM / SSO / OIDC / SAML.
- Authentik: self-hosted open-source IdP / SSO.
- Zitadel: open-source identity infrastructure.
- OpenFGA: fine-grained authorization / ReBAC / Zanzibar-style authorization.
- OPA: policy-as-code decision engine.
- Casbin: authorization library for RBAC/ABAC/ReBAC-style models.

Build order:

1. Keep RIA as dev bootstrap.
2. Add generic OIDC/JWKS validator adapter.
3. Add Keycloak fixture.
4. Add OpenFGA capability-ceiling resolver.
5. Add Entra/Okta only after generic OIDC path is green.

### Layer B — Model endpoints / LLM transports

Nexus should treat every LLM as an endpoint behind NVG, not as a special runtime.

Socket:

- `ModelTransportAdapter`
- `ModelEndpoint`
- signed endpoint manifest
- NVG routing policy

Current/reference adapters:

- OpenAI chat-style adapter.
- Anthropic messages-style adapter.
- Ollama chat-style adapter.

Local/open-source candidates:

- Ollama for local laptop/server inference.
- llama.cpp / llama-server for GGUF local models and OpenAI-compatible endpoints.
- vLLM for production-grade OpenAI-compatible serving.
- LiteLLM as optional external gateway endpoint, not as Nexus governance core.

Cloud/frontier candidates:

- OpenAI / ChatGPT API.
- Anthropic / Claude API / Claude Code boundary.
- Google Gemini API.
- Perplexity API.
- Grok/xAI API.
- Qwen / Alibaba Cloud or self-hosted Qwen through Ollama/vLLM/llama.cpp.
- Mistral, Cohere, DeepSeek, Bedrock, Vertex AI, Azure OpenAI as later adapter entries.

Build order:

1. Keep direct adapters: Ollama, OpenAI, Anthropic.
2. Make OpenAI-compatible adapter generic for vLLM, llama.cpp, LiteLLM, OpenRouter-like gateways.
3. Add Gemini adapter.
4. Add Perplexity / Grok only after generic endpoint manifest pattern is boring.
5. Keep provider-specific logic out of NVG policy decisions.

### Layer C — Agent / orchestrator wrappers

Nexus should not become an agent framework. It governs agent calls.

Socket:

- MCP adapter.
- REST adapter v2.
- post-inference action normalizer.
- connector manifests.

Candidate orchestrators / agent systems:

- n8n for workflow automation and business-process AI agents.
- Temporal for durable workflows and long-running process orchestration.
- LangGraph for stateful single/multi-agent workflows.
- CrewAI for role/team-style multi-agent experiments.
- AutoGen / Semantic Kernel / LlamaIndex / LangChain as integration candidates, not core dependencies.
- IDE/business copilots: Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Windsurf, Continue, Comet-style browsers, Pi-style assistants.

Build order:

1. Keep MCP as Adapter v1.
2. Build REST Adapter v2 as the universal non-MCP path.
3. Add n8n reference workflow: webhook/request enters workspace/orchestrator, then NXS/NVG.
4. Add Temporal reference workflow for durable multi-step execution.
5. Add LangGraph reference workflow only as external caller, not as core dependency.

### Layer D — Business target-system connectors

Nexus should govern action authority, then forward through connectors.

Socket:

- `Connector`
- connector manifest
- NXS Gate 06 execution grant
- bounded credential/secret handling

Reference/business candidates:

- Email: Gmail, Microsoft Graph/Outlook, IMAP/SMTP.
- CRM: Salesforce, HubSpot, Pipedrive.
- Inventory/ERP: Odoo, ERPNext, NetSuite/SAP adapters later.
- Docs/files: Google Drive, SharePoint, S3, MinIO, Nextcloud.
- Tickets/projects: Jira, Linear, GitHub Issues, GitLab.
- Chat/collab: Slack, Microsoft Teams, Discord.
- Databases/search: Postgres, MySQL, SQLite, OpenSearch, Elasticsearch.
- Marketing: Mailchimp, Klaviyo, Meta/Google Ads APIs later.

Build order:

1. Keep StubConnector as proof harness.
2. Build file/document connector first, because read/export/write scenarios are easy to audit.
3. Build email connector second, because approval/escalation is obvious.
4. Build CRM connector third.
5. Build inventory/ERP connector fourth.

### Layer E — Compile / return path

Nexus should govern compile mode selection, not become the enterprise’s content engine.

Socket:

- compile policy/config
- OCT-COMPILE inheritance
- final response via workspace

Candidate compile implementations:

- Deterministic renderer: tables, summaries, JSON-to-report, markdown/PDF later.
- On-prem model compile: Ollama/vLLM/llama.cpp endpoint behind policy.
- Frontier synthesis: OpenAI/Claude/Gemini only when OCT allows.
- Document renderers: Pandoc, WeasyPrint, LibreOffice headless, Playwright/Puppeteer for HTML-to-PDF.

Build order:

1. Deterministic markdown/JSON renderer.
2. OCT inheritance proof.
3. Optional on-prem synthesis endpoint.
4. Frontier synthesis only after NVG compile route is fully audited.

### Layer F — Observability / ledger / audit export

Nexus owns audit truth but can export to enterprise tools.

Socket:

- Evidence Ledger
- Routing Provenance Trail
- Run Ledger
- SIEM/export adapter later

Candidates:

- OpenSearch / Elasticsearch for searchable audit views.
- Grafana / Loki for logs and dashboards.
- SIEM targets: Splunk, Sentinel, Datadog, Elastic.
- Storage backends: Postgres, SQLite, S3/MinIO, object storage.

Build order:

1. Keep JSONL proof until audit closure is stable.
2. Add Postgres ledger backend.
3. Add OpenSearch export.
4. Add SIEM export formats.

## Purple surfaces map

Purple does not mean “build now.” It means “socket exists or will exist.”

- Identity providers: RIA now; Keycloak/Auth/OIDC later.
- Model endpoints: Ollama/OpenAI/Anthropic now; Gemini/Perplexity/Grok/Qwen/LiteLLM/vLLM later.
- Orchestrators: MCP now; REST/n8n/Temporal/LangGraph later.
- Connectors: stub now; email/files/CRM/inventory later.
- Approval channels: CLI now; webhook/Slack/Teams later.
- Compile: deterministic first; on-prem/frontier synthesis later.
- Observability: JSONL now; Postgres/OpenSearch/SIEM later.

## Anti-drift integration rule

Every integration must answer these before code starts:

1. Which socket does it plug into?
2. Which manifest declares it?
3. Which package owns the adapter?
4. Which package may import it?
5. Which gate proves it?
6. Which audit stream records it?
7. What is the fail-closed behavior?
8. What is the smallest reference test?

If those cannot be answered, do not build it yet.

## Recommended immediate docs to add

1. `docs/nexus-integration-roadmap-v0-1.md`
2. `docs/integration-sockets.md`
3. `docs/integration-candidate-matrix.md`
4. `docs/runbooks/connect-ollama.md`
5. `docs/runbooks/connect-keycloak.md`
6. `docs/runbooks/connect-n8n.md`
7. `docs/runbooks/connect-openai-compatible-endpoint.md`

## Recommended first lab wiring sequence

1. Local Ollama endpoint through endpoint manifest.
2. OpenAI-compatible endpoint path for vLLM/llama.cpp/LiteLLM.
3. Keycloak or Authentik as OIDC identity provider.
4. n8n as external orchestrator through REST/MCP.
5. Stub/file/email connectors for action proofs.
6. Deterministic compiler.
7. OpenSearch export.
