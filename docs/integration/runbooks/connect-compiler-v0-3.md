# Runbook: connect compiler v0.3

## Purpose

Connect a compiler, response assembler, report generator, or final-output synthesizer through Nexus without moving governance authority into the compiler. The compiler is a post-governance output surface. It may format and assemble approved material; it must not authorize actions, change policy, or hide evidence.

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

- Nexus socket: compiler / egress assembly boundary.
- Plane: return path after NXS/NVG governance and evidence capture.
- Canonical flow anchor: workspace → orchestrator/agent → NVG/NXS → evidence/RPT/run ledger → compiler → user.
- Compiler should consume governed outputs and ledger references, not raw bypassed tool state.

## Internal compiler shape

A local compiler module should receive:

- runId
- action/evidence references
- allowed model output/result payloads
- redaction policy result
- user-facing response requirements
- audit summary references

It should return:

- final response body
- citation/evidence references where appropriate
- compiler metadata
- no new authorization claims

## External compiler shape

If the compiler is an external service:

1. Register it as a connector or egress service.
2. Use signed config for endpoint and allowed operations.
3. Do not send secrets or unredacted restricted payloads unless policy permits.
4. Record compiler invocation in run ledger.
5. Preserve source evidence references.

## Example config concept

    compiler:
      compilerId: report-compiler-main
      enabled: true
      mode: internal
      allowedInputs:
        - governed_model_output
        - evidence_summary
        - run_metadata
      forbiddenInputs:
        - raw_secret_value
        - unsigned_policy_override

## Targeted validation

    cd ~/repos/nexus || exit 1
    pnpm exec vitest run packages/core/src/engine/pipeline-exception-proof.test.ts --reporter=verbose
    pnpm exec vitest run packages/core/src/gates/ledger-tamper.threat.test.ts --config vitest.threat.config.ts --reporter=verbose
    pnpm ci:gate

## Acceptance checklist

- Compiler cannot execute actions.
- Compiler cannot alter ledger records.
- Compiler output references runId/evidence as needed.
- Compiler receives only governed/approved payloads.
- Redaction occurs before external compiler if sensitive payload leaves Nexus boundary.

## Do not do

- Do not make compiler a policy engine.
- Do not use compiler to “fix” denied actions into allowed language.
- Do not let compiler omit audit facts required by output contract.
