# Runbook: connect observability stack v0.3

## Purpose

Connect observability tools such as OpenSearch, Elasticsearch, Loki, Grafana, Prometheus, or SIEM collectors to Nexus outputs without turning those tools into the authoritative audit ledger.

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

- Nexus source of truth: Evidence Ledger, Run Ledger, Routing Provenance Trail.
- External socket: export/ship/read-only sink.
- External tools may index, visualize, alert, and correlate.
- External tools must not rewrite Nexus ledger state.

## Flow

1. Nexus writes native evidence/RPT/run-ledger records.
2. Exporter or log shipper reads append-only outputs.
3. External observability stack indexes records.
4. Dashboards alert on denials, routing changes, OCT events, bypass annotations, and endpoint health.
5. For forensic truth, operator returns to Nexus ledger/trail files or production ledger backend.

## Candidate sinks

| Tool          | Role                 | Nexus source                          |
| ------------- | -------------------- | ------------------------------------- |
| OpenSearch    | Search/index         | Evidence/RPT/run-ledger export        |
| Elasticsearch | Search/index         | Evidence/RPT/run-ledger export        |
| Loki          | Log aggregation      | JSONL streams                         |
| Grafana       | Dashboards           | Loki/OpenSearch/Prometheus datasource |
| Prometheus    | Metrics              | counters/gauges, not full evidence    |
| SIEM          | enterprise detection | transformed event stream              |

## Export guidance

- Preserve `runId`, `actionId`, `actorId`, `principalId`, `endpointId`, and `recordHash`.
- Do not mutate record body before hash verification.
- Add exporter metadata outside the signed record body.
- Keep raw Nexus JSONL retained for independent verification.

## Suggested alerts

- Deny spike by actor or system.
- Frontier route selected for sensitive data.
- OCT assignment/change events.
- Manifest signature failure.
- Endpoint health flapping.
- Bypass annotation event.
- Cross-link mismatch from ci/runtime verification.

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/core/src/gates/ledger-tamper.threat.test.ts --config vitest.threat.config.ts --reporter=verbose
    pnpm exec vitest run packages/vanguard/src/nvg-cross-link.integration.test.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Observability receives copies, not authoritative writes.
- Hash/signature fields remain intact.
- Dashboards link back to runId/actionId.
- Sensitive data fields are redacted according to current redaction policy before external export.

## Do not do

- Do not make OpenSearch/Elastic the evidence ledger.
- Do not rely on Grafana as chain-of-custody evidence.
- Do not export raw secrets or full prompts unless policy permits.
