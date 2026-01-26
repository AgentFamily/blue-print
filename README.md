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
