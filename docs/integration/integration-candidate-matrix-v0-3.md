# Nexus integration candidate matrix v0.3

## On-prem / local model serving

| Candidate                 | Type                           | Open-source? | Nexus socket               |
| ------------------------- | ------------------------------ | -----------: | -------------------------- |
| Ollama                    | Local model runtime/API        |          Yes | NVG endpoint adapter       |
| llama.cpp server          | Local inference server         |          Yes | OpenAI-compatible endpoint |
| vLLM                      | Inference server               |          Yes | OpenAI-compatible endpoint |
| Text Generation Inference | Inference server               |          Yes | Endpoint adapter           |
| LocalAI                   | Local OpenAI-compatible server |          Yes | OpenAI-compatible endpoint |

## On-prem / local model families

| Candidate         | Type                     | Typical serving path      | Nexus socket |
| ----------------- | ------------------------ | ------------------------- | ------------ |
| Llama             | Open-weight model family | Ollama / llama.cpp / vLLM | NVG endpoint |
| Qwen              | Open-weight model family | Ollama / vLLM / llama.cpp | NVG endpoint |
| Gemma             | Open-weight model family | Ollama / llama.cpp / vLLM | NVG endpoint |
| Mistral / Mixtral | Open-weight model family | Ollama / vLLM / TGI       | NVG endpoint |
| Phi               | Small local model family | Ollama / ONNX / vLLM      | NVG endpoint |
| DeepSeek          | Open-weight model family | Ollama / vLLM             | NVG endpoint |

## Frontier / hosted model APIs

| Candidate               | Type                          | Nexus socket         |
| ----------------------- | ----------------------------- | -------------------- |
| OpenAI / ChatGPT API    | Hosted model API              | NVG endpoint adapter |
| Anthropic / Claude API  | Hosted model API              | NVG endpoint adapter |
| Google Gemini API       | Hosted model API              | NVG endpoint adapter |
| xAI Grok API            | Hosted model API              | NVG endpoint adapter |
| Perplexity API          | Hosted model/search model API | NVG endpoint adapter |
| Alibaba/Qwen hosted API | Hosted model API              | NVG endpoint adapter |

## IAM / RBAC / authorization

| Candidate | Type                       | Nexus socket              |
| --------- | -------------------------- | ------------------------- |
| Keycloak  | OIDC/IAM                   | Identity provider adapter |
| Authentik | OIDC/IAM                   | Identity provider adapter |
| Zitadel   | OIDC/IAM                   | Identity provider adapter |
| Entra ID  | Enterprise IAM             | Identity provider adapter |
| Okta      | Enterprise IAM             | Identity provider adapter |
| OpenFGA   | Relationship authorization | Connector/policy support  |

## Workflow / agent / business automation

| Candidate   | Type                | Nexus socket                       |
| ----------- | ------------------- | ---------------------------------- |
| n8n         | Workflow automation | API/MCP caller or connector target |
| Temporal    | Durable workflow    | API caller or connector target     |
| LangGraph   | Agent workflow      | Governed caller/wrapper            |
| CrewAI      | Agent framework     | Governed caller/wrapper            |
| AutoGen     | Agent framework     | Governed caller/wrapper            |
| MCP servers | Tool wrappers       | MCP adapter ingress                |

## Developer assistants

| Candidate        | Type               | Nexus socket                             |
| ---------------- | ------------------ | ---------------------------------------- |
| Cursor           | IDE assistant      | MCP/API wrapper + NVG endpoint path      |
| GitHub Copilot   | IDE/code assistant | Workspace/plugin wrapper where available |
| Claude Code      | CLI/code assistant | Shell/MCP/API wrapper                    |
| Codex/OpenAI CLI | CLI/code assistant | Shell/MCP/API wrapper                    |

## Observability

| Candidate     | Type            | Nexus socket                   |
| ------------- | --------------- | ------------------------------ |
| OpenSearch    | Search/index    | Evidence/RPT/run-ledger export |
| Elasticsearch | Search/index    | Evidence/RPT/run-ledger export |
| Loki          | Log aggregation | JSONL/export stream            |
| Grafana       | Dashboard       | Read-only visualization        |
| Prometheus    | Metrics         | Metrics export only            |
