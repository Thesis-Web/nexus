#!/usr/bin/env bash
# scripts/dev/up.sh — bring the full Nexus dev stack online.
#
# Idempotent — re-runnable. Skips work that's already done (built dist,
# running postgres, existing keys). Prints URLs + credentials at the end.
#
# Usage:
#   ./scripts/dev/up.sh
#   ./scripts/dev/up.sh --no-build   # skip pnpm build (faster restart)
#   ./scripts/dev/up.sh --no-pg      # skip postgres bring-up (no connectors)
#   ./scripts/dev/up.sh --foreground # run nexus serve in current shell
#                                    # (Ctrl+C stops it; default is bg + pidfile)
#
# Exit codes:
#   0 — stack up, URLs printed
#   1 — preflight failed (docker, pnpm, port collision, missing keys)
#   2 — build or postgres bring-up failed
#   3 — nexus serve failed to come healthy
set -euo pipefail

# ── repo root + colors ────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[36m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_RESET=''
fi

ok()    { echo "  ${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "  ${C_YELLOW}⚠${C_RESET} $*"; }
fail()  { echo "  ${C_RED}✗${C_RESET} $*" >&2; exit "${2:-1}"; }
step()  { echo "${C_BOLD}▶ $*${C_RESET}"; }

# ── flags ─────────────────────────────────────────────────────────────────
DO_BUILD=1
DO_PG=1
FOREGROUND=0
for arg in "$@"; do
  case "$arg" in
    --no-build)   DO_BUILD=0 ;;
    --no-pg)      DO_PG=0 ;;
    --foreground) FOREGROUND=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      fail "unknown flag: $arg (try --help)" 1
      ;;
  esac
done

NEXUS_PORT="${NEXUS_PORT:-7701}"
PIDFILE="$REPO_ROOT/.nexus-serve.pid"
LOGFILE="$REPO_ROOT/.nexus-serve.log"

# ── preflight ─────────────────────────────────────────────────────────────
step "Preflight"

command -v pnpm >/dev/null 2>&1 || fail "pnpm not on PATH — install pnpm first"
ok "pnpm $(pnpm --version)"

if [ "$DO_PG" -eq 1 ]; then
  command -v docker >/dev/null 2>&1 || fail "docker not on PATH (use --no-pg to skip)"
  docker info >/dev/null 2>&1 || fail "docker daemon not running (start Docker Desktop, or --no-pg)"
  ok "docker daemon reachable"
fi

# Port collision check (nexus + postgres ports if applicable)
check_port_free() {
  local port="$1" label="$2"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$"; then
    # Check if our own pidfile owns it (idempotent restart)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      warn "port $port ($label) already bound by previous nexus serve (pid $(cat "$PIDFILE")) — will reuse"
      return 0
    fi
    fail "port $port ($label) already bound — run ./scripts/dev/down.sh or free the port"
  fi
  ok "port $port ($label) free"
}
check_port_free "$NEXUS_PORT" "nexus serve"

# ── pnpm install (only if node_modules missing or stale-ish) ──────────────
if [ ! -d "$REPO_ROOT/node_modules" ]; then
  step "pnpm install (no node_modules yet)"
  pnpm install || fail "pnpm install failed" 2
  ok "dependencies installed"
fi

# ── build ─────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" -eq 1 ]; then
  step "pnpm build (use --no-build to skip)"
  pnpm build >/dev/null 2>&1 || fail "pnpm build failed — run \`pnpm build\` directly to see errors" 2
  ok "build complete"
else
  warn "skipping build (--no-build)"
fi

# ── postgres ──────────────────────────────────────────────────────────────
if [ "$DO_PG" -eq 1 ]; then
  step "postgres (docker compose)"
  docker compose -f infra/docker-compose.dev.yaml up -d >/dev/null 2>&1 \
    || fail "docker compose up failed — check docker daemon + infra/docker-compose.dev.yaml" 2

  # Wait for both healthchecks (up to 60s each)
  for svc in nexus-sales-finance nexus-warehouse; do
    for i in $(seq 1 30); do
      state="$(docker inspect --format '{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "missing")"
      if [ "$state" = "healthy" ]; then
        ok "$svc healthy"
        break
      fi
      if [ "$i" -eq 30 ]; then
        fail "$svc did not become healthy after 60s — \`docker logs $svc\` for details" 2
      fi
      sleep 2
    done
  done
else
  warn "skipping postgres (--no-pg) — connector init will skip postgres connectors"
fi

# ── keys ──────────────────────────────────────────────────────────────────
step "Keys (nexus init bootstrap)"
mkdir -p "$REPO_ROOT/keys"

needs_init=0
[ -f "$REPO_ROOT/keys/dev.keypair.json" ] || needs_init=1
[ -f "$REPO_ROOT/keys/admin.token" ]      || needs_init=1
[ -f "$REPO_ROOT/keys/mode-config.json" ] || needs_init=1

if [ "$needs_init" -eq 1 ]; then
  warn "core keys missing — running \`pnpm nexus init\`"
  pnpm nexus init >/dev/null 2>&1 || fail "nexus init failed" 1
  ok "core keys generated (dev.keypair.json + admin.token + mode-config.json)"
else
  ok "core keys present (dev.keypair.json + admin.token + mode-config.json)"
fi

# Workspace JWT secret + dev-admin api-key (nexus init does NOT generate these
# today; the serve command requires both). Synthesize via the existing
# key-manager generators if missing.
if [ ! -f "$REPO_ROOT/keys/workspace-jwt.secret" ] || [ ! -f "$REPO_ROOT/keys/workspace-dev-admin.apikey" ]; then
  warn "workspace JWT secret + dev-admin api-key missing — generating"
  pnpm exec tsx scripts/dev/_gen-workspace-keys.ts >/dev/null 2>&1 \
    || fail "workspace key generation failed — \`pnpm exec tsx scripts/dev/_gen-workspace-keys.ts\` for details" 1
  ok "workspace JWT secret + dev-admin api-key generated"
else
  ok "workspace JWT secret + dev-admin api-key present"
fi

# Admin signing keypair for the dev-admin principal — required by
# SigningCouncilServerSigner + AdminMutationServerSigner + ModeSigner.
# Without it, every admin write fails 412 admin_signing_keypair_missing.
DEV_ADMIN_PRINCIPAL="00000000-0000-4000-a000-000000000001"
if [ ! -f "$REPO_ROOT/keys/admins/${DEV_ADMIN_PRINCIPAL}.keypair.json" ] \
   || [ ! -f "$REPO_ROOT/keys/admins/${DEV_ADMIN_PRINCIPAL}.public.json" ]; then
  warn "dev-admin signing keypair missing — generating"
  pnpm exec tsx scripts/dev/_gen-admin-signing-keypair.ts >/dev/null 2>&1 \
    || fail "admin signing keypair generation failed — \`pnpm exec tsx scripts/dev/_gen-admin-signing-keypair.ts\` for details" 1
  ok "dev-admin signing keypair generated"
else
  ok "dev-admin signing keypair present"
fi

# ── nexus serve ───────────────────────────────────────────────────────────
step "nexus serve (port $NEXUS_PORT)"

# Clear any stale pidfile pointing at a dead process
if [ -f "$PIDFILE" ]; then
  if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    warn "previous nexus serve still running (pid $(cat "$PIDFILE")) — leaving alone; restart with ./scripts/dev/down.sh first"
  else
    rm -f "$PIDFILE"
  fi
fi

start_serve_bg() {
  : > "$LOGFILE"
  nohup pnpm exec tsx scripts/nexus-main.ts -- serve --port "$NEXUS_PORT" \
    >>"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
}

# If no pidfile or the process is dead, start fresh
if [ ! -f "$PIDFILE" ] || ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  if [ "$FOREGROUND" -eq 1 ]; then
    ok "starting in foreground — Ctrl+C stops the server"
    echo
    exec pnpm exec tsx scripts/nexus-main.ts -- serve --port "$NEXUS_PORT"
  fi
  start_serve_bg
  ok "spawned nexus serve (pid $(cat "$PIDFILE")) — log at .nexus-serve.log"
fi

# Health probe — wait up to 20s
for i in $(seq 1 20); do
  if curl -s -m 2 "http://127.0.0.1:$NEXUS_PORT/health" 2>/dev/null | grep -q '"status":"healthy"'; then
    ok "nexus serve healthy"
    break
  fi
  if [ "$i" -eq 20 ]; then
    fail "nexus serve did not respond healthy after 40s — tail .nexus-serve.log" 3
  fi
  sleep 2
done

# ── summary ───────────────────────────────────────────────────────────────
echo
echo "${C_BOLD}${C_GREEN}═══ Nexus dev stack is up ═══${C_RESET}"
echo
echo "  ${C_BLUE}Workspace UI${C_RESET}  → http://127.0.0.1:$NEXUS_PORT/"
echo "  ${C_BLUE}Health${C_RESET}         → http://127.0.0.1:$NEXUS_PORT/health"
echo "  ${C_BLUE}Server log${C_RESET}     → $LOGFILE"
echo "  ${C_BLUE}Server pid${C_RESET}     → $(cat "$PIDFILE" 2>/dev/null || echo 'foreground')"
echo

if [ -f "$REPO_ROOT/keys/workspace-dev-admin.apikey" ]; then
  apikey="$(cat "$REPO_ROOT/keys/workspace-dev-admin.apikey" | tr -d '\n')"
  echo "  ${C_BOLD}Login${C_RESET} (workspace UI):"
  echo "    1. open http://127.0.0.1:$NEXUS_PORT/"
  echo "    2. on the login screen, choose ${C_BOLD}API key${C_RESET}"
  echo "    3. paste this value:"
  echo
  echo "       $apikey"
  echo
fi

if [ -f "$REPO_ROOT/keys/admin.token" ]; then
  admin="$(cat "$REPO_ROOT/keys/admin.token" | tr -d '\n')"
  echo "  ${C_BOLD}Admin bearer token${C_RESET} (server-side /admin/* routes, for curl/scripts):"
  echo
  echo "       $admin"
  echo
fi

echo "  ${C_BOLD}Dashboard entry${C_RESET}: after workspace login, click the ${C_BOLD}Admin${C_RESET} entry button in the topbar"
echo "  to reach /admin. Re-auth elevation is required for admin write surfaces."
echo
echo "  Stop with: ${C_BOLD}./scripts/dev/down.sh${C_RESET}"
echo "  Status:    ${C_BOLD}./scripts/dev/status.sh${C_RESET}"
