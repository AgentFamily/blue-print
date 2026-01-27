# The Agent Family

┌────────────────────────────────────────────────────────────────────────────┐
│ SYSTEM MEMORY PIPELINE — GLOBAL CONFIGURATION                               │
│ (Shortcut → Notes → Alignment Layer)                                         │
├────────────────────────────────────────────────────────────────────────────┤
│ CAPTURE → STRUCTURE → STORE → RECALL                                        │
│                                                                            │
│ • Capture                                                                   │
│   - Manual / passive triggers                                               │
│   - Selected text, full screen, OCR fallback                                │
│   - Timestamp (UTC + monotonic)                                             │
│   - Source surface (app / domain / modal / PDF)                             │
│                                                                            │
│ • Structure                                                                 │
│   - Meaning-preserving reduction (no semantic drift)                       │
│   - Clause normalization                                                    │
│   - Metadata bound to content (not adjacent)                                │
│                                                                            │
│ • Store                                                                     │
│   - Apple Notes as immutable ledger                                         │
│   - Raw text + structured digest                                            │
│   - Hash committed before write                                             │
│                                                                            │
│ • Recall                                                                    │
│   - Human rereading                                                         │
│   - Machine diffing                                                         │
│   - Audit / proof / comparison                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ Clipboard + cache purge: ENABLED (per command)                              │
│ Purpose: reduce LAN visibility & residual data retention                    │
└────────────────────────────────────────────────────────────────────────────┘

## Token Gate Demo (Vercel)

- UI: `token-gate.html` (calls `POST /api/prompt`)
- Serverless: `api/prompt.js` (reads `AI_GATEWAY_API_KEY`)
- Optional env: `AI_GATEWAY_BASE_URL`, `AI_MODEL`

## AgentC-oins (Stripe + Magic)

- UI: `Contents/Resources/Homepage.html` (shows balance + opens Stripe Payment Link)
- Balance API: `GET /api/tokens/balance` (requires `Authorization: Bearer <Magic ID token>`)
- Webhook: `POST /api/stripe/webhook` (Stripe `checkout.session.completed` → credits tokens)
- First login bonus: new accounts get `77` free AgentC-oins (only if they have no prior balance in KV).

Required env (Vercel/Node serverless):
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
- `STRIPE_WEBHOOK_SECRET`
- One of:
  - `STRIPE_ALLOWED_PAYMENT_LINKS` (JSON map of `payment_link_id` → tokens, e.g. `{"plink_...":200}`)
  - or `STRIPE_PAYMENT_LINK_ID` + optional `STRIPE_PAYMENT_LINK_TOKENS` (defaults to `200`)
