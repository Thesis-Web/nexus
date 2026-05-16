# scripts/dev — local dev stack scripts

One-command bring-up / tear-down / status probe for the full Nexus dev
stack: workspace + admin server, two postgres connectors, all the keys
and secrets the server needs at boot.

## Quickstart

```bash
./scripts/dev/up.sh        # build, postgres, keys, serve — print URLs + credentials
./scripts/dev/status.sh    # what's running, what's healthy
./scripts/dev/down.sh      # stop everything (data retained)
```

Then open <http://127.0.0.1:7701/> and log in with the api-key the
script prints. Click the **Admin** button in the topbar to reach
`/admin`; re-auth elevation is required for write surfaces.

## Prerequisites

- **pnpm** (`pnpm --version` must work)
- **docker** with Docker Desktop / engine running (only required for
  postgres connectors — use `--no-pg` to skip)
- **node** 20+ via the workspace's pinned tooling

If `pnpm install` hasn't run yet, `up.sh` runs it automatically.

## Scripts

### `up.sh` — bring the stack online

Idempotent. Re-running it is safe (skips work that's already done).

```
./scripts/dev/up.sh
./scripts/dev/up.sh --no-build      # skip pnpm build (faster restart)
./scripts/dev/up.sh --no-pg         # skip postgres (no connectors)
./scripts/dev/up.sh --foreground    # run nexus serve in current shell
                                    #   (Ctrl+C to stop; default is bg)
```

What it does, in order:

1. **Preflight** — pnpm + docker present, target port free
2. **Install** — `pnpm install` only if `node_modules/` is missing
3. **Build** — `pnpm build` (skip with `--no-build`)
4. **Postgres** — `docker compose up -d`, wait for both healthchecks
5. **Keys** — runs `nexus init` if core keys missing; runs
   `scripts/dev/_gen-workspace-keys.ts` if workspace keys missing
6. **Serve** — spawns `pnpm exec tsx scripts/nexus-main.ts -- serve`
   in the background (pidfile at `.nexus-serve.pid`, log at
   `.nexus-serve.log`)
7. **Health probe** — polls `/health` until ready
8. **Print** the URLs + credentials block

### `down.sh` — stop the stack

```
./scripts/dev/down.sh                # stop server + postgres; data retained
./scripts/dev/down.sh --no-pg        # only stop nexus serve, leave postgres
./scripts/dev/down.sh --wipe-data    # FULL reset — drops postgres volumes
                                     #   (irreversible; deletes all seeded data)
```

Sends SIGTERM to the pid in `.nexus-serve.pid`, waits up to 5s, then
SIGKILL if needed. Cleans up the pidfile.

### `status.sh` — read-only probe

Reports up/down/unknown for:

- nexus serve process + `/health`
- both postgres containers (running + healthy)
- every required key file
- per-admin signing keypair (and its `.public.json` companion — Arc 4)
- `keys/secrets.json` postgres connector entries
- a live `/workspace/auth/login` probe with the dev-admin api-key

Always exits 0 (status report, not a gate).

### `_gen-workspace-keys.ts` — internal helper

Generates `keys/workspace-jwt.secret` + `keys/workspace-dev-admin.apikey`
when they're missing. Called by `up.sh`; not meant to be invoked
directly. Underscore prefix marks it as dev-only.

## What gets created on first run

| Path | Created by | Notes |
|---|---|---|
| `keys/dev.keypair.json` | `nexus init` | Ed25519 control-plane keypair |
| `keys/admin.token` | `nexus init` | bearer token for `/admin/*` server-side routes |
| `keys/mode-config.json` | `nexus init` | signed initial mode config (enforcing/enforcing, locked) |
| `keys/workspace-jwt.secret` | `_gen-workspace-keys.ts` | HMAC-SHA256 secret for workspace JWTs |
| `keys/workspace-dev-admin.apikey` | `_gen-workspace-keys.ts` | api-key value the dev workspace login accepts |
| `nexus.db` | first `serve` invocation | SQLite store for actors / principals / sessions / approvals |
| postgres volumes | `docker compose up` | seeded sales-finance + warehouse data |

## URLs

- **Workspace UI** — <http://127.0.0.1:7701/>
- **Health** — <http://127.0.0.1:7701/health>
- **WebSocket runs** — `ws://127.0.0.1:7701/ws/runs/<runId>?ticket=<id>`

## Login flow

1. Open the workspace UI
2. Choose **API key** on the login screen
3. Paste the value from `keys/workspace-dev-admin.apikey` (`up.sh`
   prints it; or just `cat keys/workspace-dev-admin.apikey`)
4. You're in. The topbar shows agent + model + workspace dropdowns
5. Click the **Admin** entry button (top-right) to reach `/admin`
6. Admin write surfaces require elevated re-auth via the vault auth
   flow — the UI prompts for it on first write attempt

## Common issues

**Port 7701 already in use.**
Something else is bound (or a previous nexus serve didn't shut down).
Run `./scripts/dev/down.sh` then `./scripts/dev/status.sh`. If the
process isn't ours, `lsof -i :7701` to find the owner.

**Docker daemon not running.**
Start Docker Desktop / the docker engine. Or run with `--no-pg` if
you don't need postgres connectors.

**postgres container exists but won't go healthy.**
Tail its log: `docker logs nexus-sales-finance` (or `-warehouse`).
Usually an init-SQL failure on first volume creation. Wipe + retry:
`./scripts/dev/down.sh --wipe-data && ./scripts/dev/up.sh`.

**`UNKNOWN_ADMIN` when calling the mode unlock route.**
The admin's signing keypair file exists but the `.public.json`
companion doesn't. Arc 4 fixup added the auto-companion on POST
`/workspace/admin/setup/admin-keys` — re-upload via that route.
`status.sh` reports this case explicitly per admin.

**Workspace login returns 401 / Unauthorized.**
- Check `keys/workspace-jwt.secret` and `keys/workspace-dev-admin.apikey`
  exist (status.sh reports)
- Check the api-key value you pasted matches the file exactly (no
  trailing newline)
- The token expires after ~8h; log in again

**Connector won't register at boot.**
The postgres connector requires `POSTGRES_SALES_FINANCE_PASSWORD` and
`POSTGRES_WAREHOUSE_PASSWORD` in `keys/secrets.json` (vault-encoded).
status.sh reports this. If you're on a fresh clone, the secrets need
to be seeded — that's a separate setup step beyond these scripts'
scope (the dev box typically inherits these from a prior session).

## Backgrounding / pidfile model

`up.sh` defaults to background mode using `nohup` + a pidfile at
`.nexus-serve.pid`. `down.sh` reads the pidfile. Both files are
gitignored.

If you want to see server logs live in your terminal, run with
`--foreground`. Ctrl+C stops the server cleanly.

## What these scripts do NOT do

- They don't seed model endpoints / agents / connectors beyond what
  `nexus init` and the bundled seeds produce. The dev box you've
  been working in has those already.
- They don't run vitest / ci:gate. Use `pnpm test` / `pnpm ci:gate`.
- They don't run integration tests against the live server. Use
  `NEXUS_RUN_INTEGRATION=1 pnpm test:integration`.
- They don't manage the workspace SPA dev-mode (vite hot-reload).
  This stack serves the built bundle from `packages/workspace-ref/dist/`.
  For SPA hot-reload, run `pnpm --filter @nexus/workspace-ref dev`
  separately and point it at the running server.
