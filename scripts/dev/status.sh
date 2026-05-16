#!/usr/bin/env bash
# scripts/dev/status.sh — what's running, what's healthy, what isn't.
#
# Read-only probe. Safe to run anytime. Exits 0 even when things are down
# (this is a status report, not a gate).
#
# Usage:
#   ./scripts/dev/status.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[36m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_RESET=''
fi

up()    { echo "  ${C_GREEN}● UP${C_RESET}    $*"; }
down()  { echo "  ${C_RED}○ DOWN${C_RESET}  $*"; }
warn()  { echo "  ${C_YELLOW}? UNK${C_RESET}   $*"; }
step()  { echo "${C_BOLD}▶ $*${C_RESET}"; }

NEXUS_PORT="${NEXUS_PORT:-7701}"
PIDFILE="$REPO_ROOT/.nexus-serve.pid"

# ── nexus serve ───────────────────────────────────────────────────────────
step "nexus serve (port $NEXUS_PORT)"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  pid="$(cat "$PIDFILE")"
  health="$(curl -s -m 2 "http://127.0.0.1:$NEXUS_PORT/health" 2>/dev/null || true)"
  if echo "$health" | grep -q '"status":"healthy"'; then
    up "process pid=$pid; /health=healthy"
  else
    warn "process pid=$pid; /health did not respond healthy"
  fi
elif pgrep -f "tsx scripts/nexus-main.ts -- serve" >/dev/null 2>&1; then
  pid="$(pgrep -f 'tsx scripts/nexus-main.ts -- serve' | head -1)"
  warn "running (pid $pid) but NO pidfile — was started outside up.sh"
else
  down "nexus serve not running"
fi

# ── postgres ──────────────────────────────────────────────────────────────
step "postgres (docker compose)"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for svc in nexus-sales-finance nexus-warehouse; do
    state="$(docker inspect --format '{{.State.Status}}' "$svc" 2>/dev/null || echo missing)"
    health="$(docker inspect --format '{{.State.Health.Status}}' "$svc" 2>/dev/null || echo none)"
    if [ "$state" = "running" ] && [ "$health" = "healthy" ]; then
      up "$svc (running, healthy)"
    elif [ "$state" = "running" ]; then
      warn "$svc (running, health=$health)"
    elif [ "$state" = "missing" ]; then
      down "$svc (container not created — run \`./scripts/dev/up.sh\`)"
    else
      down "$svc (state=$state)"
    fi
  done
else
  warn "docker not reachable — skipping postgres probe"
fi

# ── keys ──────────────────────────────────────────────────────────────────
step "keys (required files)"
for kp in \
  "keys/dev.keypair.json:control-plane keypair" \
  "keys/admin.token:admin bearer token" \
  "keys/mode-config.json:signed mode config" \
  "keys/workspace-jwt.secret:workspace JWT HMAC secret" \
  "keys/workspace-dev-admin.apikey:dev-admin api-key (workspace login)" \
  ; do
  path="${kp%%:*}"
  label="${kp##*:}"
  if [ -f "$REPO_ROOT/$path" ]; then
    up "$path  ($label)"
  else
    down "$path  ($label)"
  fi
done

# ── admin signing keypairs (per-admin) ────────────────────────────────────
step "admin signing keypairs (admins/<id>.keypair.json + .public.json)"
if [ -d "$REPO_ROOT/keys/admins" ]; then
  found=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    base="$(basename "$f" .keypair.json)"
    if [ -f "$REPO_ROOT/keys/admins/$base.public.json" ]; then
      up "$base (keypair + public.json)"
    else
      warn "$base (keypair WITHOUT .public.json — unlock route will fail; re-upload via admin-keys POST)"
    fi
    found=$((found + 1))
  done <<<"$(ls "$REPO_ROOT/keys/admins"/*.keypair.json 2>/dev/null || true)"
  if [ "$found" -eq 0 ]; then
    warn "no admin signing keypairs registered — mode-signing/unlock routes will 412"
  fi
else
  warn "keys/admins/ does not exist — mode-signing routes will 412 until an admin keypair is uploaded"
fi

# ── secrets (vault file) ──────────────────────────────────────────────────
step "secrets (keys/secrets.json — connector credentials)"
if [ -f "$REPO_ROOT/keys/secrets.json" ]; then
  if grep -q "POSTGRES_SALES_FINANCE_PASSWORD" "$REPO_ROOT/keys/secrets.json" \
     && grep -q "POSTGRES_WAREHOUSE_PASSWORD" "$REPO_ROOT/keys/secrets.json"; then
    up "postgres connector secrets present"
  else
    warn "secrets.json present but postgres connector entries missing — connectors won't start"
  fi
else
  down "secrets.json missing — postgres connectors won't register at boot"
fi

# ── workspace login probe (if server is up) ───────────────────────────────
step "workspace login probe"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null \
   && [ -f "$REPO_ROOT/keys/workspace-dev-admin.apikey" ]; then
  apikey="$(cat "$REPO_ROOT/keys/workspace-dev-admin.apikey" | tr -d '\n')"
  login_res="$(curl -s -m 5 -X POST "http://127.0.0.1:$NEXUS_PORT/workspace/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"api_key\",\"value\":\"$apikey\"}" 2>/dev/null || true)"
  if echo "$login_res" | grep -q '"ok":true'; then
    up "/workspace/auth/login returns a JWT for the dev-admin api-key"
  else
    warn "/workspace/auth/login did not succeed — response: $(echo "$login_res" | head -c 200)"
  fi
else
  warn "skipped (server not up OR dev-admin api-key missing)"
fi

# ── handy URLs ────────────────────────────────────────────────────────────
echo
echo "${C_BOLD}URLs${C_RESET}"
echo "  ${C_BLUE}Workspace UI${C_RESET}  http://127.0.0.1:$NEXUS_PORT/"
echo "  ${C_BLUE}Health${C_RESET}        http://127.0.0.1:$NEXUS_PORT/health"
echo "  ${C_BLUE}Server log${C_RESET}    $REPO_ROOT/.nexus-serve.log"
