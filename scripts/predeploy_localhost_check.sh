#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNC_SCRIPT="$APP_ROOT/Contents/Resources/sync_agentc_runtime.sh"
SERVER_SCRIPT_DEFAULT="$HOME/Library/Application Support/LocalLLM/bin/dev_server.py"
SERVER_SCRIPT="${AGENTC_SERVER_SCRIPT:-$SERVER_SCRIPT_DEFAULT}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || echo /usr/bin/python3)}"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
NODE_BIN="${NODE_BIN:-node}"

PORT="${PORT:-8000}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
UPSTREAM_DEFAULT="${OLLAMA_UPSTREAM:-http://127.0.0.1:11434}"
RESTART_SERVER="${RESTART_SERVER:-1}"
SERVER_LOG="${SERVER_LOG:-/tmp/agentc_predeploy_server.log}"
STOVE_WORKSPACE_ID="${STOVE_WORKSPACE_ID:-ws_core}"

TMP_DIR="$(mktemp -d /tmp/agentc_predeploy.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

ok() {
  printf '[ok] %s\n' "$1"
}

warn() {
  printf '[warn] %s\n' "$1"
}

fail() {
  printf '[fail] %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

extract_ps_flag_value() {
  local cmd="$1"
  local flag="$2"
  "$PYTHON_BIN" - "$cmd" "$flag" <<'PY'
import shlex
import sys

cmd = sys.argv[1]
flag = sys.argv[2]

try:
    parts = shlex.split(cmd)
except Exception:
    parts = cmd.split()

for idx, part in enumerate(parts):
    if part == flag and idx + 1 < len(parts):
        print(parts[idx + 1])
        break
PY
}

restart_server() {
  local pid cmd lan_flag="" upstream="$UPSTREAM_DEFAULT" status=""

  if [[ ! -f "$SERVER_SCRIPT" ]]; then
    SERVER_SCRIPT="$APP_ROOT/Contents/Resources/dev_server.py"
  fi
  [[ -f "$SERVER_SCRIPT" ]] || fail "Could not find dev server script."

  pid="$(/usr/sbin/lsof -t -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$pid" ]]; then
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmd" == *"--lan"* ]]; then
      lan_flag="--lan"
    fi
    upstream="$(extract_ps_flag_value "$cmd" "--upstream")"
    upstream="${upstream:-$UPSTREAM_DEFAULT}"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.4
  fi

  nohup env AGENTC_APP_ROOT="$APP_ROOT" NODE_BIN="$NODE_BIN" "$PYTHON_BIN" "$SERVER_SCRIPT" --port "$PORT" --host 127.0.0.1 ${lan_flag:+"$lan_flag"} --upstream "$upstream" >"$SERVER_LOG" 2>&1 &

  for _ in $(seq 1 60); do
    status="$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "${BASE_URL}/health" || true)"
    if [[ "$status" == "200" ]]; then
      ok "Local server restarted on ${BASE_URL} (log: ${SERVER_LOG})"
      return 0
    fi
    sleep 0.25
  done

  fail "Local server did not become healthy on ${BASE_URL}. See ${SERVER_LOG}."
}

fetch_status() {
  local url="$1"
  local out="$2"
  shift 2
  curl -sS -o "$out" -w '%{http_code}' "$@" "$url"
}

require_command curl
require_command rg
require_command "$PYTHON_BIN"

[[ -x "$SYNC_SCRIPT" ]] || fail "Missing sync script at ${SYNC_SCRIPT}"

"$SYNC_SCRIPT"
ok "Runtime synced into LocalLLM site/bin"

if [[ "$RESTART_SERVER" == "1" ]]; then
  restart_server
else
  warn "Skipped local server restart (RESTART_SERVER=${RESTART_SERVER})"
fi

homepage_html="$TMP_DIR/homepage.html"
homepage_status="$(fetch_status "${BASE_URL}/" "$homepage_html")"
[[ "$homepage_status" == "200" ]] || fail "Homepage check failed for ${BASE_URL}/ (HTTP ${homepage_status})"
ok "Homepage reachable at ${BASE_URL}/"

app_core_js="$TMP_DIR/app_core.js"
app_core_status="$(fetch_status "${BASE_URL}/app_core.js" "$app_core_js")"
[[ "$app_core_status" == "200" ]] || fail "app_core.js check failed for ${BASE_URL}/app_core.js (HTTP ${app_core_status})"
ok "Magic auth runtime reachable at ${BASE_URL}/app_core.js"

redirect_headers="$TMP_DIR/homepage_headers.txt"
curl -sS -D "$redirect_headers" -o /dev/null "${BASE_URL}/Homepage.html" >/dev/null
redirect_line="$(tr -d '\r' < "$redirect_headers" | rg '^Location:' -N || true)"
if rg -q '^HTTP/.* 302 ' "$redirect_headers"; then
  ok "Homepage redirect is active (${redirect_line:-Location: /})"
else
  warn "Homepage redirect check did not return 302"
fi

homepage_meta="$("$PYTHON_BIN" - "$homepage_html" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text("utf-8", errors="ignore")
tokens = re.findall(r'window\.__MK_TOOL_TOKEN\s*=\s*"([^"]+)"', text)
secret_hits = {
    "sk_openai_like": bool(re.search(r'sk-(?:proj-)?[A-Za-z0-9_-]{20,}', text)),
    "magic_secret_like": bool(re.search(r'sk_[A-Za-z0-9_-]{20,}', text)),
}
print(len(tokens))
print(tokens[-1] if tokens else "")
print("1" if any(secret_hits.values()) else "0")
PY
)"

token_count="$(printf '%s\n' "$homepage_meta" | sed -n '1p')"
tool_token="$(printf '%s\n' "$homepage_meta" | sed -n '2p')"
secret_hit="$(printf '%s\n' "$homepage_meta" | sed -n '3p')"

[[ "$token_count" == "1" ]] || fail "Expected exactly one injected tool token in served homepage, found ${token_count}"
[[ -n "$tool_token" ]] || fail "Failed to extract live tool token from served homepage"
[[ "$secret_hit" == "0" ]] || fail "Served homepage contains a secret-like token"
ok "Served homepage token injection is clean"

if rg -q 'window\.__MK_TOOL_TOKEN="' "$APP_ROOT/Contents/Resources/Homepage.html"; then
  fail "Source Homepage.html still contains a hardcoded tool token"
fi

if rg -Pq 'pk_(live|test)_[A-Za-z0-9]{12,}' "$APP_ROOT/Contents/Resources/Homepage.html"; then
  fail "Source Homepage.html still contains a hardcoded Magic publishable key"
fi

if rg -q 'sk-(proj-)?[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9_-]{20,}' "$APP_ROOT/Contents/Resources/Homepage.html"; then
  fail "Source Homepage.html still contains a secret-like token"
fi
ok "Source homepage is free of hardcoded tool tokens and key literals"

health_json="$TMP_DIR/health.json"
health_status="$(fetch_status "${BASE_URL}/health" "$health_json")"
[[ "$health_status" == "200" ]] || fail "Health route failed (HTTP ${health_status})"
ok "Health route returned 200"

browser_probe_json="$TMP_DIR/browser_probe.json"
browser_probe_status="$(fetch_status "${BASE_URL}/browser/probe?url=https%3A%2F%2Fexample.com" "$browser_probe_json")"
[[ "$browser_probe_status" == "200" ]] || fail "Browser probe failed (HTTP ${browser_probe_status})"
ok "Browser probe returned 200"

browser_read_json="$TMP_DIR/browser_read.json"
browser_read_status="$(fetch_status "${BASE_URL}/browser/read?url=https%3A%2F%2Fexample.com" "$browser_read_json")"
[[ "$browser_read_status" == "200" ]] || fail "Browser read failed (HTTP ${browser_read_status})"
ok "Browser read returned 200"

tool_list_json="$TMP_DIR/tool_list.json"
tool_list_status="$(curl -sS -o "$tool_list_json" -w '%{http_code}' -H 'Content-Type: application/json' -H "X-MK-Tool-Token: ${tool_token}" -d '{"path":"."}' "${BASE_URL}/tool/list_dir")"
[[ "$tool_list_status" == "200" ]] || fail "Tool list_dir failed (HTTP ${tool_list_status})"
ok "Loopback tool call returned 200"

stove_json="$TMP_DIR/stove.json"
stove_status="$(curl -sS -o "$stove_json" -w '%{http_code}' -H 'Content-Type: application/json' -H "X-MK-Tool-Token: ${tool_token}" -d "{\"workspaceId\":\"${STOVE_WORKSPACE_ID}\"}" "${BASE_URL}/api/stove/session")"
[[ "$stove_status" == "200" ]] || fail "Stove session failed (HTTP ${stove_status})"
ok "Stove session route returned 200"

magic_config_json="$TMP_DIR/magic_config.json"
magic_config_status="$(fetch_status "${BASE_URL}/api/magic/config" "$magic_config_json")"
case "$magic_config_status" in
  200)
    ok "Magic config route is reachable and configured"
    ;;
  500)
    if rg -q 'Missing MAGIC_PUBLISHABLE_KEY' "$magic_config_json"; then
      warn "Magic config route is wired, but MAGIC_PUBLISHABLE_KEY is not set for the running server"
    else
      fail "Magic config route returned unexpected 500"
    fi
    ;;
  *)
    fail "Magic config route failed (HTTP ${magic_config_status})"
    ;;
esac

magic_wallet_json="$TMP_DIR/magic_wallet.json"
magic_wallet_status="$(curl -sS -o "$magic_wallet_json" -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' "${BASE_URL}/api/magic/wallet")"
case "$magic_wallet_status" in
  400|403)
    ok "Magic wallet route is wired"
    ;;
  *)
    fail "Magic wallet route failed unexpectedly (HTTP ${magic_wallet_status})"
    ;;
esac

magic_idp_json="$TMP_DIR/magic_idp.json"
magic_idp_status="$(curl -sS -o "$magic_idp_json" -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' "${BASE_URL}/api/magic/identity_provider")"
[[ "$magic_idp_status" == "403" ]] || fail "Magic identity_provider route failed unexpectedly (HTTP ${magic_idp_status})"
ok "Magic identity provider route is wired (admin gate enforced)"

if ! rg -q 'Connect Email Logs' "$homepage_html"; then
  fail "Homepage is missing the Email Logs copy update"
fi

if ! rg -q 'magic-email-logs' "$homepage_html"; then
  fail "Homepage is missing the magic-email-logs channel mapping"
fi

if ! rg -q 'Sign in with Magic Link' "$homepage_html"; then
  fail "Homepage is missing the Magic-first vault copy"
fi
if ! rg -q 'Send Sign-in Code|Enter Verification Code' "$app_core_js"; then
  fail "Served app_core.js is missing the inline Magic verification flow"
fi
ok "Magic vault and email log UI copy is present on localhost"

printf '\nSummary\n'
printf '  Base URL: %s\n' "$BASE_URL"
printf '  Tool token source: served homepage injection\n'
printf '  Magic config status: %s\n' "$magic_config_status"
printf '  Browser routes: %s/%s\n' "$browser_probe_status" "$browser_read_status"
printf '  Tool + Stove routes: %s/%s\n' "$tool_list_status" "$stove_status"
