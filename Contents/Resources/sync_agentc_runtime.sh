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

echo "Syncing UI + servers…"

mkdir -p "$GLOBAL_BIN" "$GLOBAL_SITE"
cp -f "$RES_DIR/Homepage.html" "$GLOBAL_SITE/Homepage.html"
cp -f "$RES_DIR/emoji-palette.json" "$GLOBAL_SITE/emoji-palette.json"
cp -f "$RES_DIR/dev_server.py" "$GLOBAL_BIN/dev_server.py"
cp -f "$RES_DIR/ollama_proxy.py" "$GLOBAL_ROOT/ollama_proxy.py"
chmod 755 "$GLOBAL_BIN/dev_server.py" "$GLOBAL_ROOT/ollama_proxy.py" || true

mkdir -p "$CONTAINER_BIN" "$CONTAINER_SITE"
cp -f "$RES_DIR/Homepage.html" "$CONTAINER_SITE/Homepage.html"
cp -f "$RES_DIR/emoji-palette.json" "$CONTAINER_SITE/emoji-palette.json"
cp -f "$RES_DIR/dev_server.py" "$CONTAINER_BIN/dev_server.py"
cp -f "$RES_DIR/ollama_proxy.py" "$CONTAINER_ROOT/ollama_proxy.py"
chmod 755 "$CONTAINER_BIN/dev_server.py" "$CONTAINER_ROOT/ollama_proxy.py" || true

echo "Updating app preferences…"
defaults write Ai.AgentC "AgentC.serverHost" "localhost"
defaults write Ai.AgentC "AgentC.serverPort" -int 8000
defaults write Ai.AgentC "AgentC.ollamaUpstream" "http://localhost:11434"

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
  echo "codesign failed"
  exit 1
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
  codesign --verify --deep --strict "$APP_BUNDLE"
  exit 1
fi

echo "Done."
