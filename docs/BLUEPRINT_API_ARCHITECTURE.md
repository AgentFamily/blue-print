# Blue-Print.AI API Architecture

## Folder structure

```text
api/
  auth/
    login.js
    logout.js
    me.js
  workspaces.js
  connectors.js
  connectors/
    index.js
    [connectorId]/
      requirements.js
      authorize.js
      test.js
  vault/
    secrets.js
  widgets/
    manifests.js
    [widgetId]/
      run.js

lib/blueprint/
  types.js
  types.d.ts
  errors.js
  http.js
  security.js
  audit.js
  db.js
  route_helpers.js
  connectors/
    base_connector.js
    fasthosts_connector.js
    mock_api_connector.js
    registry.js
  services/
    auth_service.js
    context_service.js
    workspace_service.js
    connector_service.js
    manifest_service.js
    widget_runner_service.js
  vault/
    crypto.js
    service.js
  catalog.js

prisma/
  schema.prisma

tests/
  blueprint_vault.test.js
  blueprint_connector.test.js
  blueprint_manifest.test.js
  blueprint_catalog.test.js
  blueprint_install_ui.test.js
```

## Fixed endpoints implemented

- `POST /api/auth/login` (also `GET` helper for CSRF bootstrap)
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/workspaces`
- `GET /api/connectors`
- `GET /api/connectors/:connectorId/requirements`
- `GET|POST /api/connectors/:connectorId/authorize`
- `GET|POST /api/connectors/:connectorId/test`
- `GET|POST|PUT|DELETE /api/vault/secrets`
- `GET|POST|PUT|DELETE /api/widgets/manifests`
- `POST /api/widgets/:widgetId/run`

## Security and enforcement

- Session JWT in `httpOnly` cookie (`bp_session`)
- CSRF token cookie (`bp_csrf`) + `x-csrf-token` header checks for mutating routes
- Rate limiting on auth login + connector test routes
- Vault secrets encrypted at rest via AES-256-GCM using `KEYRING`
- Vault metadata only on reads, plaintext only once at creation
- Workspace role checks before connector, vault, and widget actions
- Audit logs for auth, vault, connector auth/test, and widget runs

## Connector and manifest contracts

- Connector interface: `id`, `label`, `authType`, `requirements()`, `authorize()`, `test()`, `request()`
- Sample connector implemented: `FasthostsConnector` (`apiKey` auth)
- Additional strategic connectors: `namecheap`, `autotrader`, `myclickdealer`, `booking`, `skyscanner`, `openai`, `meta_ads`, `zillow`, `rightmove`
- Widget manifest validation (zod if installed, strict manual fallback otherwise)
- Widget run enforcement returns `authorizationPlan` when required connectors/scopes are missing
- Strategic widget manifests auto-seeded:
  - Domain Valuator (Fasthosts + Namecheap)
  - Car Valuator (Autotrader + MyClickDealer)
  - Trip Finder (Booking + Skyscanner)
  - Ad Generator (OpenAI + Meta Ads)
  - Property Evaluator (Zillow + Rightmove)
- Clear install UI:
  - JSON actions for each connector include `installConnectorLabel` + `installConnectorUrl`
  - `GET /api/connectors?view=install&workspaceId=...` renders an install center with header-level **Install \<API\>** buttons for all connectors
  - `GET /api/connectors/:connectorId/authorize` also renders a header bar with **Install \<API\>** buttons for all connectors
