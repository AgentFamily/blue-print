# AgentC App

⸻

1️⃣ Pipeline / framed version of the UK governing-law clause

### Pipelines
The engine is intentionally simplistic: sequentially dispatch nodes using a
handler map (`api/_lib/pipeline_engine.js`).  Only `intake`, `qualify` and
`crm_sync` are implemented, but adding new types is as easy as registering a
function that receives `{ run, node }` and returns output.

A simple workflow engine has been integrated.

* Templates stored in KV under `pipe:def:{id}`. Nodes may include an optional `requires` array of provider names for connections (e.g. `["hubspot","stripe"]`).  Execution handlers live in `api/_lib/handlers.js` and are invoked by
`api/_lib/pipeline_engine.js`.
* Runs stored under `pipe:run:{runId}` with per-node state `pipe:run:{runId}:node:{node}`.
* Routes:
  * `GET/POST /api/pipelines` – list or create templates
  * `POST /api/pipelines/run` – start a new run
  * `GET /api/pipelines/run?runId=` – fetch run
  * `GET /api/pipelines/runs` – list recent runs
  * `POST /api/pipelines/cancel` – cancel run
  * `POST /api/pipelines/retry` – retry failed node

Dashboard exposes a "Pipelines" tab with run history and quick-create.
An execution engine (`api/_lib/pipeline_engine.js`) processes nodes
sequentially and supports retrying failed nodes.


You can drop this anywhere (footer, modal, checkout, PDF):

┌───────────────────────────────────────────────────────────────┐
│ GOVERNING LAW & JURISDICTION                                   │
│                                                               │
│ These Terms and any dispute or claim arising out of or in      │
│ connection with them (including non-contractual disputes or   │
│ claims) shall be governed by and construed in accordance with │
│ the laws of England and Wales.                                 │
│                                                               │
│ The courts of England and Wales shall have exclusive           │
│ jurisdiction to settle any dispute or claim.                  │
└───────────────────────────────────────────────────────────────┘

If you want a lighter / inline “pipeline” style instead:

| Governing Law |
These Terms and any dispute or claim arising out of or in connection
with them (including non-contractual disputes or claims) shall be
governed by and construed in accordance with the laws of England
and Wales. The courts of England and Wales shall have exclusive
jurisdiction.

Both are standard-looking and acceptable.

⸻

2️⃣ Cleaned & finalised UK Terms & Conditions

(Same content you provided, just tightened formatting and clarity — nothing softened)

⸻

Terms and Conditions

Last Updated: 02/02/2026

These Terms and Conditions (“Terms”) govern your access to and use of TheAgentFamily.com Tokens (“Platform”, “we”, “us”, or “our”).

By accessing or using the Platform, you agree to be legally bound by these Terms. If you do not agree, you must not use the Platform.

⸻

1. Platform Overview

The Platform provides automated services facilitating transactions between users and third-party service providers (“Service Providers”).

The Platform operates on an automated and continuous basis, including payment processing and distribution of funds, without manual intervention.

⸻

2. Payments & Authorisation

By making a payment through the Platform, you expressly authorise us to:
	•	charge your selected payment method,
	•	process payments automatically,
	•	allocate and distribute funds between the Platform and Service Providers,
	•	deduct applicable platform fees prior to distribution.

All payments are processed by third-party payment processors (including Stripe). We do not store card or bank details.

⸻

3. No Refund Policy

ALL PAYMENTS ARE FINAL AND NON-REFUNDABLE.

By completing a payment, you acknowledge and agree that:
	•	no refunds will be issued under any circumstances,
	•	no cancellations or reversals are permitted,
	•	no partial refunds will be granted.

This includes, without limitation:
	•	dissatisfaction with services,
	•	perceived lack of results or value,
	•	misunderstanding of the Platform,
	•	partial or non-use of services,
	•	delays, interruptions, or third-party performance.

You waive any right to request a refund once a payment has been completed.

⸻

4. Automated Distribution of Funds

Payments are automatically allocated between the Platform and Service Providers in accordance with predefined rules.

Once processed:
	•	allocations are immediate and irreversible,
	•	funds sent to Service Providers cannot be recalled,
	•	payment distributions cannot be amended.

You acknowledge that these processes occur automatically and without human review.

⸻

5. Third-Party Service Providers

Service Providers operate independently of the Platform.

We:
	•	do not guarantee outcomes,
	•	do not supervise or control Service Providers,
	•	are not responsible for their acts or omissions.

Any disputes with Service Providers must be resolved directly with them.

⸻

6. No Warranties

The Platform is provided “as is” and “as available”, without warranties of any kind, whether express or implied.

We make no guarantees regarding availability, accuracy, or suitability for any purpose.

⸻

7. Limitation of Liability

To the fullest extent permitted by law:
	•	we shall not be liable for any indirect, incidental, or consequential loss,
	•	our total liability shall not exceed the total amount paid by you to the Platform in the preceding 30 days.

Nothing in these Terms excludes liability that cannot be excluded under UK law.

⸻

8. Account Suspension & Termination

We reserve the right to suspend or terminate access to the Platform at our sole discretion.

Termination does not entitle you to a refund.

⸻

9. Chargebacks & Abuse

Any attempt to initiate a chargeback, reverse a payment, or abuse the payment system may result in:
	•	immediate termination,
	•	permanent restriction from the Platform,
	•	recovery of losses where permitted by law.

⸻

10. Governing Law & Jurisdiction (UK)

These Terms and any dispute or claim arising out of or in connection with them (including non-contractual disputes or claims) shall be governed by and construed in accordance with the laws of England and Wales.

The courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim.

⸻

11. Changes to These Terms

We may update these Terms at any time. Continued use of the Platform constitutes acceptance of the updated Terms.

⸻

12. Acceptance

By using the Platform or completing a payment, you confirm that you have read, understood, and agree to be bound by these Terms.

⸻

✅
By continuing you accept all terms and conditions 
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

---

## Magic: register OIDC identity provider (server-side)

Do **not** put `sk_…` keys in frontend code. Configure `MAGIC_SECRET_KEY` in your hosting environment, then call the server route:

- Endpoint: `POST /api/magic/identity_provider` (admin-only via `mk_admin=1` cookie)

### Connected accounts

New API routes have been added for managing external integrations.

* `GET /api/accounts` – list connected providers
* `POST /api/accounts/connect` – create connection (API key or OAuth)
* `POST /api/accounts/disconnect` – remove connection
* `POST /api/accounts/test` – health-check a provider
* `GET /api/accounts/oauth_callback` – OAuth redirect target (stub)

Providers are configured in `api/_lib/providers.js` with metadata and optional
`test` helpers. OAuth entries declare `authorizeUrl`, `tokenUrl` and
`defaultScopes`; API-key entries may provide a `validate` function.  At
runtime the `/api/accounts/connect` route uses this registry to determine
whether to redirect for OAuth or accept a key.

OAuth flows use environment variables such as `HUBSPOT_CLIENT_ID`,
`HUBSPOT_REDIRECT_URI`; the example implementation of
`api/accounts/oauth_callback.js` simply fakes a vault token but shows where
you would exchange a code for a token.

Dashboard UI now includes a "Connected Accounts" tab under Settings where you
can view, test and connect providers via quick prompts (future work: polished
modals).  A "Connect new" button will walk through API key or OAuth flow.

UI rendering helpers for these panels have been extracted into
`public/Contents/Resources/settings_panels.js` for better organization.

For deployments, set the appropriate redirect URIs pointing to
`https://YOURDOMAIN/api/accounts/oauth_callback` and populate client IDs/secrets.

#### Running the Node helpers

Two utility scripts have been added under `tests/` that exercise the new code:

```sh
node tests/test_accounts.js   # simple CRUD against Upstash KV
node tests/test_pipelines.js  # create a template and start a run
```

These are lightweight smoke tests and require a working `UPSTASH_REDIS_REST_URL`
env variable to talk to your KV instance.

- Env var: `MAGIC_SECRET_KEY=sk_…`

Example (run locally from a secure terminal; replace placeholders):

```bash
curl -X POST 'https://YOUR_DOMAIN/api/magic/identity_provider' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: mk_admin=1' \
  -d '{
    "issuer": "https://your-auth-provider.com",
    "audience": "your-app-audience",
    "jwks_uri": "https://your-auth-provider.com/.well-known/jwks.json"
  }'
```
