# Magic Localhost Pre-Deploy

This is the repeatable localhost verification path for the AgentC runtime after the Magic-first vault changes.

## What It Verifies

- Syncs `Homepage.html` and `dev_server.py` into the LocalLLM runtime.
- Restarts the localhost dev server so route checks run against the current code.
- Confirms the served homepage has exactly one injected tool token and no secret-like literals.
- Verifies browser routes, loopback tool calls, Stove session calls, and Magic API route wiring.
- Confirms the Magic-first vault copy and the `magic-email-logs` memory channel are present on localhost.

## One Command

```bash
./scripts/predeploy_localhost_check.sh
```

Useful overrides:

```bash
PORT=8001 BASE_URL=http://localhost:8001 ./scripts/predeploy_localhost_check.sh
RESTART_SERVER=0 ./scripts/predeploy_localhost_check.sh
OLLAMA_UPSTREAM=http://127.0.0.1:11434 ./scripts/predeploy_localhost_check.sh
```

## Required Environment

Keep secrets in environment only. Do not hardcode them into `Homepage.html`, docs, or committed scripts.

```bash
export MAGIC_PUBLISHABLE_KEY='pk_live_your_publishable_key'
export MAGIC_SECRET_KEY='sk_your_secret_key'
export MAGIC_PROVIDER_ID='your_magic_provider_id'
export MAGIC_CHAIN='ETH'
```

Notes:

- `MAGIC_PUBLISHABLE_KEY` is client-facing by design and can appear in runtime responses.
- `MAGIC_SECRET_KEY` must stay server-side only.
- The predeploy check treats a `500 Missing MAGIC_PUBLISHABLE_KEY` from `/api/magic/config` as "route is wired but env is not configured yet".

## Localhost Command Map

Sync runtime:

```bash
./Contents/Resources/sync_agentc_runtime.sh
```

Restart localhost dev server cleanly:

```bash
PID="$(/usr/sbin/lsof -t -nP -iTCP:8000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [ -n "$PID" ]; then kill "$PID"; fi
nohup python3 "$HOME/Library/Application Support/LocalLLM/bin/dev_server.py" \
  --port 8000 \
  --host 127.0.0.1 \
  --upstream http://127.0.0.1:11434 \
  >/tmp/agentc_predeploy_server.log 2>&1 &
```

Restart localhost dev server with the app bundle wired in for local API routes and Stove:

```bash
AGENTC_APP_ROOT="/Applications/AgentC .app" \
NODE_BIN="$(command -v node)" \
nohup python3 "$HOME/Library/Application Support/LocalLLM/bin/dev_server.py" \
  --port 8000 \
  --host 127.0.0.1 \
  --upstream http://127.0.0.1:11434 \
  >/tmp/agentc_predeploy_server.log 2>&1 &
```

Check homepage and health:

```bash
curl -I http://localhost:8000/
curl -sS http://localhost:8000/health
curl -I http://localhost:8000/Homepage.html
```

Extract the live tool token from the served homepage:

```bash
TOKEN="$(
  curl -sS http://localhost:8000/ |
  python3 -c 'import re,sys; text=sys.stdin.read(); print(re.findall(r"window\\.__MK_TOOL_TOKEN\\s*=\\s*\"([^\"]+)\"", text)[-1])'
)"
```

Loopback tool call:

```bash
curl -sS http://localhost:8000/tool/list_dir \
  -H "Content-Type: application/json" \
  -H "X-MK-Tool-Token: $TOKEN" \
  -d '{"path":"."}'
```

Stove session compile:

```bash
curl -sS http://localhost:8000/api/stove/session \
  -H "Content-Type: application/json" \
  -H "X-MK-Tool-Token: $TOKEN" \
  -d '{"workspaceId":"ws_core"}'
```

Browser probe and read:

```bash
curl -sS 'http://localhost:8000/browser/probe?url=https%3A%2F%2Fexample.com'
curl -sS 'http://localhost:8000/browser/read?url=https%3A%2F%2Fexample.com'
```

Magic config:

```bash
curl -sS http://localhost:8000/api/magic/config
```

Magic wallet through the local API route:

```bash
curl -sS http://localhost:8000/api/magic/wallet \
  -H 'Content-Type: application/json' \
  -d '{
    "jwt": "'"$AUTH_PROVIDER_JWT"'",
    "provider_id": "'"$MAGIC_PROVIDER_ID"'",
    "chain": "ETH"
  }'
```

Magic wallet through the localhost-only dev route:

```bash
curl -sS http://localhost:8000/server/magic/wallet \
  -H 'Content-Type: application/json' \
  -d '{
    "jwt": "'"$AUTH_PROVIDER_JWT"'",
    "provider_id": "'"$MAGIC_PROVIDER_ID"'",
    "chain": "ETH"
  }'
```

Magic identity provider registration through the local API route:

```bash
curl -sS http://localhost:8000/api/magic/identity_provider \
  -H 'Content-Type: application/json' \
  -H 'Cookie: mk_admin=1' \
  -d '{
    "issuer": "https://your-auth-provider.com",
    "audience": "your-app-audience",
    "jwks_uri": "https://your-auth-provider.com/.well-known/jwks.json"
  }'
```

Direct upstream provider registration:

```bash
curl -X POST 'https://tee.express.magiclabs.com/v1/identity/provider' \
  -H 'Content-Type: application/json' \
  -H "X-Magic-Secret-Key: $MAGIC_SECRET_KEY" \
  -d '{
    "issuer": "https://your-auth-provider.com",
    "audience": "your-app-audience",
    "jwks_uri": "https://your-auth-provider.com/.well-known/jwks.json"
  }'
```

## Expected Route Outcomes

- `GET /api/magic/config`
  Returns `200` when configured, or `500 Missing MAGIC_PUBLISHABLE_KEY` when the route is healthy but env is missing.
- `POST /api/magic/wallet`
  Returns `400` when `jwt` or `provider_id` is missing. That still proves the route is wired.
- `POST /api/magic/identity_provider`
  Returns `403` without the `mk_admin=1` cookie. That proves the admin gate is active.
- `POST /tool/list_dir`
  Returns `200` with a valid `X-MK-Tool-Token`.
- `POST /api/stove/session`
  Returns `200` with a valid `X-MK-Tool-Token` and a reachable workspace such as `ws_core`.
