# Runbook: Connect compiler v0.2

## Purpose

This runbook explains how to connect a compiler / final-answer assembler to Nexus.

The compiler is the final assembly boundary. It turns governed outputs into the user-facing result.

Examples:

- final chat answer
- meeting summary
- inventory report
- sales summary
- email draft
- R&D brief
- product strategy memo
- audit packet

The compiler is not a model router. It is not an action executor. It does not approve, deny, or grant authority.

## Nexus socket

| Field             | Value                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Socket name       | Compiler socket                                                                                    |
| Direction         | outbound final assembly / return path                                                              |
| Governance plane  | reads governed outputs; does not govern independently                                              |
| Upstream inputs   | Run Ledger, Evidence Ledger, Routing Provenance Trail, normalized model response, execution result |
| Downstream output | final user-facing compiled artifact                                                                |
| Must not do       | direct model calls, direct connector calls, policy bypass, approval bypass                         |

## Current repo anchors

| Purpose                           | Repo path                                                    |
| --------------------------------- | ------------------------------------------------------------ |
| Evidence record / contract shapes | `packages/contracts/src/interfaces/index.ts`                 |
| NXS pipeline result               | `packages/core/src/engine/pipeline.ts`                       |
| Evidence write boundary           | `packages/core/src/gates/07-evidence.gate.ts`                |
| Routing trail backend             | `packages/vanguard/src/trail/jsonl-routing-trail.backend.ts` |
| NVG inbound normalization         | `packages/vanguard/src/inbound/response-normalizer.ts`       |
| API server composition            | `packages/interfaces/api/src/server.ts`                      |
| CLI/API composition root          | `scripts/nexus-main.ts`, `scripts/nexus-bootstrap.ts`        |

If a path has moved, inspect with:

    cd ~/repos/nexus || exit 1
    find packages scripts -type f | grep -E "evidence|run-ledger|routing|normalizer|compiler|pipeline"

## Correct flow

The compiler receives a completed governed run.

Flow:

1. Workspace/API/MCP starts a run.
2. NXS/NVG perform governed work.
3. Evidence Ledger records action decisions.
4. Routing Provenance Trail records model routing and response normalization.
5. Run Ledger records lifecycle and cross-stream references.
6. Compiler reads governed stream outputs by `runId`.
7. Compiler emits final output with provenance references.

## Interface shape

A compiler implementation should be injected as an interface from the lawful composition root.

Minimal contract:

    interface CompileInput {
      runId: string
      evidenceRecordIds: string[]
      routingTrailEntryIds: string[]
      executionResultIds: string[]
      normalizedModelOutputs: unknown[]
      requestedFormat: 'answer' | 'summary' | 'report' | 'email_draft' | 'audit_packet'
    }

    interface CompileOutput {
      runId: string
      compiledAt: string
      outputType: string
      content: string
      provenance: {
        evidenceRecordIds: string[]
        routingTrailEntryIds: string[]
        runLedgerEntryIds: string[]
      }
    }

## Where to wire it

Wire compiler in the lawful composition root, not inside gates/adapters/connectors.

Allowed wiring location:

- `scripts/nexus-bootstrap.ts` or current single lawful composition root after COMPOSE cleanup.

Do not wire compiler inside:

- `packages/core/src/gates/`
- `packages/vanguard/src/router/`
- `packages/adapters/mcp/src/`
- `packages/connectors/`

## Local/internal compiler connection

Use this first.

Steps:

1. Define compiler contract in `packages/contracts`.
2. Implement internal compiler service in the chosen lawful package.
3. Inject compiler from the composition root.
4. API/CLI calls compiler only after the governed run is complete.
5. Compiler reads evidence/RPT/run-ledger by `runId`.
6. Compiler returns content plus provenance IDs.

## External compiler connection

Use this only if the compiler is a separate service.

Request body to external compiler should include governed inputs only:

    {
      "runId": "...",
      "requestedFormat": "report",
      "evidence": [...],
      "routingTrail": [...],
      "executionResults": [...]
    }

Response must include provenance:

    {
      "runId": "...",
      "compiledAt": "...",
      "content": "...",
      "provenance": {
        "evidenceRecordIds": [...],
        "routingTrailEntryIds": [...],
        "runLedgerEntryIds": [...]
      }
    }

## Config shape

For v0.2, compiler can be local config rather than signed manifest.

Suggested future path:

    config/compiler/compiler.v1.yaml

Suggested fields:

    compilerId: local-compiler-v1
    compilerType: internal
    allowedOutputTypes:
      - answer
      - summary
      - report
      - email_draft
      - audit_packet
    requiresProvenance: true
    allowDirectModelCalls: false
    allowDirectConnectorCalls: false

If compiler config becomes a trust-bearing manifest, use the signed manifest loader pattern.

## Validation checklist

- Compiler receives `runId`.
- Compiler reads governed streams only.
- Compiler output contains provenance IDs.
- Compiler has no direct connector registry.
- Compiler has no direct model transport registry.
- Compiler does not own policy decisions.
- Compiler output is linked to Run Ledger.
- Missing evidence fails closed.

## Targeted tests

Suggested tests:

    packages/core/src/compiler/compiler-service.test.ts
    packages/interfaces/api/src/routes/compile.test.ts
    packages/interfaces/cli/src/commands/compile.test.ts

Test cases:

- compile succeeds for completed run with evidence
- compile fails when runId has no evidence
- compile fails when routing trail entry is malformed
- compile includes evidence IDs in provenance
- compile does not call NVG transport adapter
- compile does not call NXS connector registry

## Do not

- Do not call OpenAI, Claude, Gemini, Ollama, or any model provider directly from compiler.
- Do not execute actions from compiler.
- Do not let compiler approve work.
- Do not let compiler rewrite evidence.
- Do not emit final output without provenance.
