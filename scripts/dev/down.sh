#!/usr/bin/env bash
# scripts/dev/down.sh — stop the Nexus dev stack.
#
# Stops nexus serve (via pidfile) and brings postgres down (data retained
# by default). Use --wipe-data to also remove docker volumes (full reset).
#
# Usage:
#   ./scripts/dev/down.sh             # stop server + postgres; data retained
#   ./scripts/dev/down.sh --no-pg     # only stop nexus serve, leave postgres
#   ./scripts/dev/down.sh --wipe-data # FULL reset — drops postgres volumes
#                                     # (irreversible; deletes all seeded data)
#
# Exit code 0 = success or already-down.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BOLD=''; C_RESET=''
fi

ok()    { echo "  ${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "  ${C_YELLOW}⚠${C_RESET} $*"; }
step()  { echo "${C_BOLD}▶ $*${C_RESET}"; }

# ── flags ─────────────────────────────────────────────────────────────────
DO_PG=1
WIPE_DATA=0
for arg in "$@"; do
  case "$arg" in
    --no-pg)      DO_PG=0 ;;
    --wipe-data)  WIPE_DATA=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $arg (try --help)" >&2; exit 1 ;;
  esac
done

PIDFILE="$REPO_ROOT/.nexus-serve.pid"

# ── stop nexus serve ─────────────────────────────────────────────────────
step "nexus serve"
if [ -f "$PIDFILE" ]; then
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # Wait up to 5s for graceful exit
    for i in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "pid $pid did not exit gracefully — sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
    ok "stopped nexus serve (was pid $pid)"
  else
    warn "pidfile present but process $pid not running"
  fi
  rm -f "$PIDFILE"
else
  # Fallback — sweep any orphaned serve processes
  if pgrep -f "tsx scripts/nexus-main.ts -- serve" >/dev/null 2>&1; then
    warn "no pidfile but stray nexus serve detected — pkill sweep"
    pkill -f "tsx scripts/nexus-main.ts -- serve" 2>/dev/null || true
    ok "swept stray processes"
  else
    ok "nexus serve already stopped"
  fi
fi

# ── postgres ──────────────────────────────────────────────────────────────
if [ "$DO_PG" -eq 1 ]; then
  step "postgres"
  if [ "$WIPE_DATA" -eq 1 ]; then
    warn "${C_RED}--wipe-data set — postgres VOLUMES will be deleted${C_RESET}"
    warn "all seeded sales-finance + warehouse data will be lost"
    docker compose -f infra/docker-compose.dev.yaml down -v >/dev/null 2>&1 \
      || warn "docker compose down -v reported errors (may already be down)"
    ok "postgres stopped + volumes removed"
  else
    docker compose -f infra/docker-compose.dev.yaml down >/dev/null 2>&1 \
      || warn "docker compose down reported errors (may already be down)"
    ok "postgres stopped (data retained — \`./scripts/dev/up.sh\` to resume)"
  fi
else
  warn "skipping postgres (--no-pg)"
fi

echo
echo "${C_BOLD}${C_GREEN}═══ Nexus dev stack is down ═══${C_RESET}"
