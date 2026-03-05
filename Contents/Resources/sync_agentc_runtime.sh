#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_BUNDLE="$(cd "$SCRIPT_DIR/../.." && pwd)"
RES_DIR="$SCRIPT_DIR"

GLOBAL_ROOT="$HOME/Library/Application Support/LocalLLM"
GLOBAL_BIN="$GLOBAL_ROOT/bin"
GLOBAL_SITE="$GLOBAL_ROOT/site"

CONTAINER_ROOT="$HOME/Library/Containers/Ai.AgentC/Data/Library/Application Support/AgentC/LocalLLM"
CONTAINER_BIN="$CONTAINER_ROOT/bin"
CONTAINER_SITE="$CONTAINER_ROOT/site"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || echo /usr/bin/python3)}"
SYNC_RESTART_LOG="/tmp/agentc_sync_restart.log"

echo "Syncing UI + servers…"

mkdir -p "$GLOBAL_BIN" "$GLOBAL_SITE"
cp -f "$RES_DIR/Homepage.html" "$GLOBAL_SITE/Homepage.html"
cp -f "$RES_DIR/dev_server.py" "$GLOBAL_BIN/dev_server.py"
cp -f "$RES_DIR/ollama_proxy.py" "$GLOBAL_ROOT/ollama_proxy.py"
chmod 755 "$GLOBAL_BIN/dev_server.py" "$GLOBAL_ROOT/ollama_proxy.py" || true

mkdir -p "$CONTAINER_BIN" "$CONTAINER_SITE"
cp -f "$RES_DIR/Homepage.html" "$CONTAINER_SITE/Homepage.html"
cp -f "$RES_DIR/dev_server.py" "$CONTAINER_BIN/dev_server.py"
cp -f "$RES_DIR/ollama_proxy.py" "$CONTAINER_ROOT/ollama_proxy.py"
chmod 755 "$CONTAINER_BIN/dev_server.py" "$CONTAINER_ROOT/ollama_proxy.py" || true

# Keep site assets in sync (icons, JSON palettes, and UI scripts).
typeset -a SITE_ASSETS=("$RES_DIR"/*.(png|svg|json|js))
for asset in "${SITE_ASSETS[@]}"; do
  [[ -f "$asset" ]] || continue
  base="$(basename "$asset")"
  cp -f "$asset" "$GLOBAL_SITE/$base"
  cp -f "$asset" "$CONTAINER_SITE/$base"
done

ensure_browser_route_on_8000() {
  local pid http_code cmd
  pid="$(/usr/sbin/lsof -t -nP -iTCP:8000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  [[ -n "$pid" ]] || return 0

  http_code="$(curl -sS -o /dev/null -m 3 -w "%{http_code}" "http://localhost:8000/browser/read?url=https%3A%2F%2Fexample.com" || true)"
  if [[ "$http_code" == "200" ]]; then
    return 0
  fi

  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$cmd" != *"dev_server.py"* ]]; then
    return 0
  fi

  echo "Refreshing homepage server on :8000 (missing /browser/read route)..."
  kill "$pid" >/dev/null 2>&1 || true
  sleep 0.2
  if [[ -x "$GLOBAL_BIN/start-homepage-server.sh" ]]; then
    nohup "$GLOBAL_BIN/start-homepage-server.sh" >"$SYNC_RESTART_LOG" 2>&1 &
  else
    nohup "$PYTHON_BIN" "$GLOBAL_BIN/dev_server.py" --port 8000 --host 127.0.0.1 --upstream http://127.0.0.1:11434 >"$SYNC_RESTART_LOG" 2>&1 &
  fi
}

ensure_browser_route_on_8000

echo "Updating app preferences…"
defaults write Ai.AgentC "AgentC.serverHost" "localhost"
defaults write Ai.AgentC "AgentC.serverPort" -int 8000
defaults write Ai.AgentC "AgentC.ollamaUpstream" "http://localhost:11434"

if [[ "${AGENTC_SYNC_CODESIGN:-0}" != "1" ]]; then
  echo "Skipping app bundle codesign (set AGENTC_SYNC_CODESIGN=1 to enable)."
  echo "Done."
  exit 0
fi

echo "Re-signing app bundle…"
strip_xattrs() {
  xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -rd com.apple.FinderInfo "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -rd com.apple.provenance "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -rd com.apple.fileprovider.fpfs#P "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -d com.apple.FinderInfo "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -d com.apple.provenance "$APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -d com.apple.fileprovider.fpfs#P "$APP_BUNDLE" >/dev/null 2>&1 || true
}

signed=0
for _ in {1..6}; do
  strip_xattrs
  if codesign --force --deep --sign - --preserve-metadata=entitlements,requirements,flags "$APP_BUNDLE"; then
    signed=1
    break
  fi
  sleep 0.12
done
if [ "$signed" -ne 1 ]; then
  echo "codesign failed (non-fatal for runtime sync)"
  echo "Done."
  exit 0
fi

verified=0
for _ in {1..6}; do
  strip_xattrs
  if codesign --verify --deep --strict "$APP_BUNDLE" >/dev/null; then
    verified=1
    break
  fi
  sleep 0.12
done
if [ "$verified" -ne 1 ]; then
  echo "codesign verify failed (non-fatal for runtime sync)"
  echo "Done."
  exit 0
fi

echo "Done."
