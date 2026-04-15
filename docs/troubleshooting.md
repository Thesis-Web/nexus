# Nexus Troubleshooting

## Start here

Always return to repository root first:

  cd ~/repos/nexus || exit 1

Then run the standard validation path:

  pnpm build
  pnpm format:check
  pnpm ci:gate

## `pnpm exec nexus --help` fails

Most likely causes:
- build outputs do not exist yet
- package/bin wiring is broken
- workspace install is incomplete

Try:

  pnpm install
  pnpm build
  pnpm exec nexus --help
  pnpm exec nexus-mcp-proxy --help

## `PolicySignatureError`

Meaning:
- policy file is unsigned
- policy file was modified after signing
- wrong key or wrong signature path is in use

Best solve:
- inspect the policy file
- re-sign it with the correct signing flow
- rerun `pnpm ci:gate`

Do not hand-edit signed policy files and assume they remain valid.

## `SESSION_NOT_FOUND`

Meaning:
- the provided session does not exist in store
- adapter-supplied session reference is stale or wrong

Best solve:
- create a session explicitly
- verify the session ID being used
- confirm you are in the correct local runtime state

## `SESSION_EXPIRED`

Meaning:
- the session exists, but Gate 01 rejected it on expiry

Best solve:
- create a new session
- use an appropriate TTL for the test or operator run

## `ENVIRONMENT_MISMATCH`

Meaning:
- resolved target environment does not match delegation environment

Best solve:
- inspect actor environment
- inspect delegation environment
- do not try to force environment from adapter headers

## `CHAIN_INTEGRITY_BROKEN`

Meaning:
- parent delegation is missing
- ledger chain linkage is broken
- signed evidence chain or delegation chain has been damaged or is incomplete

Best solve:
- inspect the referenced parent delegation
- inspect the local DB / run state
- rerun chain verification after restoring valid state

## `APPROVAL_SIG_INVALID`

Meaning:
- approval response did not verify against the approver registry
- wrong approver ID or wrong key material is being used

Best solve:
- verify the approver exists in registry
- verify `keys/approvers/<approverId>.keypair.json`
- regenerate the approver key if needed
- retry approval with explicit approver ID

## `REPLAY_DETECTED`

Meaning:
- the same action ID was seen again within the replay window

Best solve:
- generate a fresh action path
- do not reuse action IDs across reruns unless the test is intentionally proving replay denial

## `BROAD_TOKEN_BYPASS` or grant failures

Meaning:
- connector execution path violated grant law
- grant missing, expired, or mismatched to template integrity

Best solve:
- rerun through the normal Gate 04 → Gate 06 path
- do not bypass grant minting or grant redemption checks
- inspect connector behavior before changing core law

## Management API problems

Current law:
- localhost only
- admin bearer token required

Check:
- API is bound to `127.0.0.1`
- `keys/admin.token` exists
- you are sending the correct bearer token

## Gate path is green locally but you still do not trust it

Run the full operator closeout:

  pnpm build
  pnpm format:check
  pnpm ci:gate
  pnpm exec nexus --help
  pnpm exec nexus-mcp-proxy --help

Then inspect:
- `git status --short`
- `runs/`
- generated evidence
- docs changes versus canon memo and spec
