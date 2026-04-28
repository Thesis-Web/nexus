# Integration Candidate Matrix v0.1

Inclusion does not make a tool a runtime dependency.

## Identity / IAM / RBAC

| Candidate | Type                  |    Open-source? | Nexus socket              |
| --------- | --------------------- | --------------: | ------------------------- |
| Keycloak  | IAM / OIDC / SAML     |             Yes | IdentityProviderInterface |
| Authentik | IAM / SSO             |             Yes | IdentityProviderInterface |
| Zitadel   | IAM / OIDC            | Yes / open core | IdentityProviderInterface |
| OpenFGA   | Fine-grained authz    |             Yes | Policy/claims projection  |
| OPA       | Policy engine         |             Yes | Policy import / adjunct   |
| Casbin    | Authorization library |             Yes | Policy adjunct            |
| Entra ID  | Enterprise IdP        |              No | IdentityProviderInterface |
| Okta      | Enterprise IdP        |              No | IdentityProviderInterface |

## On-prem / local model serving

| Candidate                 | Type                           | Open-source? | Nexus socket               |
| ------------------------- | ------------------------------ | -----------: | -------------------------- |
| Ollama                    | Local model runtime/API        |          Yes | NVG endpoint adapter       |
| llama.cpp server          | Local inference server         |          Yes | OpenAI-compatible endpoint |
| vLLM                      | Inference server               |          Yes | OpenAI-compatible endpoint |
| Text Generation Inference | Inference server               |          Yes | Endpoint adapter           |
| LocalAI                   | Local OpenAI-compatible server |          Yes | OpenAI-compatible endpoint |

## Frontier / hosted model APIs

| Candidate                   | Nexus socket         |
| --------------------------- | -------------------- |
| OpenAI / ChatGPT API        | NVG endpoint adapter |
| Anthropic Claude            | NVG endpoint adapter |
| Google Gemini               | NVG endpoint adapter |
| xAI Grok                    | NVG endpoint adapter |
| Perplexity                  | NVG endpoint adapter |
| Mistral                     | NVG endpoint adapter |
| Cohere                      | NVG endpoint adapter |
| Together / Fireworks / Groq | NVG endpoint adapter |
| OpenRouter                  | Gateway endpoint     |
| LiteLLM                     | Gateway endpoint     |

## Workflow / agents / business automation

| Candidate | Type                   |     Open-source? | Business use cases               |
| --------- | ---------------------- | ---------------: | -------------------------------- |
| n8n       | Workflow automation    | Source available | Inventory, CRM, email, sales ops |
| Temporal  | Durable workflow       |              Yes | Long-running business processes  |
| LangGraph | Agent workflow         |              Yes | Multi-step agent state           |
| CrewAI    | Agent orchestration    |              Yes | Role-based agent workflows       |
| AutoGen   | Multi-agent framework  |              Yes | Research/analysis agents         |
| Dify      | LLM app platform       |              Yes | App-builder surface              |
| Flowise   | Low-code LLM workflows |              Yes | Quick lab workflows              |
| Haystack  | RAG/search framework   |              Yes | Search/R&D workflows             |
| Continue  | IDE coding assistant   |              Yes | Governed coding workflow         |
| Aider     | CLI coding agent       |              Yes | Repo automation                  |
