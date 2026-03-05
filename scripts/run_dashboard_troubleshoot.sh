#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${DASHBOARD_BASE_URL:-http://127.0.0.1:8010/Homepage.html}"

exec node "$ROOT_DIR/scripts/dashboard_troubleshoot_runner.cjs" --base-url "$BASE_URL" "$@"
