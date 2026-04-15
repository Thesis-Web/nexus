# Nexus CLI Usage

## Purpose

This guide is a practical CLI-facing reference for the current Nexus POC.

Always start from repository root:

  cd ~/repos/nexus || exit 1

## Main entry points

Development path:

  pnpm nexus --help
  pnpm nexus:mcp

Built-bin path:

  pnpm exec nexus --help
  pnpm exec nexus-mcp-proxy --help

## Command families

The current CLI surface includes command families for:

- `init`
- `session`
- `delegate`
- `run`
- `approve`
- `deny`
- `ledger`
- `policy`
- `actor`
- `principal`
- `approver`
- `posture`
- `replay`

Always use subcommand help before execution if you are not certain of the exact flags:

  pnpm nexus <command> --help

Examples:

  pnpm nexus init --help
  pnpm nexus session --help
  pnpm nexus delegate --help
  pnpm nexus run --help
  pnpm nexus approve --help
  pnpm nexus deny --help

## Common flows

### Initialize local runtime materials

  pnpm nexus init

### Generate an approver key

  pnpm nexus approver keygen --approver-id <approverId>

### Start a session

  pnpm nexus session start --actor <actorId> --delegation <delegationId>

Optional TTL, when supported by the current command contract:

  pnpm nexus session start --actor <actorId> --delegation <delegationId> --ttl <seconds>

### Create or inspect delegation

  pnpm nexus delegate --help

### Run a scenario or action

  pnpm nexus run --help

### Approve a pending approval

  pnpm nexus approve --help

### Deny a pending approval

  pnpm nexus deny --help

### Inspect ledger, posture, or replay surfaces

  pnpm nexus ledger --help
  pnpm nexus posture --help
  pnpm nexus replay --help

## Recommended operator habit

Use the CLI help surface every time you touch a command family you have not used recently.
That keeps the docs helpful without drifting into fake flag contracts.

## Notes

- Sessions are explicit.
- Adapters do not auto-create sessions.
- Approval and denial require explicit approver identity handling.
- Built-bin execution should work after `pnpm build`.
