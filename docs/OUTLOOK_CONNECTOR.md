# Outlook Connector

The `outlook` connector is a first-class MailSSOT connector for Outlook.com personal accounts.

## Required Environment Variables

- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`
- `OUTLOOK_REDIRECT_URI`
- `OUTLOOK_OAUTH_SCOPES` (optional)

If `OUTLOOK_OAUTH_SCOPES` is not set, the connector defaults to:

- `openid`
- `email`
- `profile`
- `offline_access`
- `Mail.ReadWrite`
- `Mail.Send`

## Microsoft App Registration

Configure the Azure app registration for personal Microsoft accounts only.

- Supported account type: personal Microsoft accounts (`consumers`)
- Redirect URI: must exactly match `OUTLOOK_REDIRECT_URI`
- Callback route: `/api/connectors/oauth/callback`

The connector uses Microsoft Graph delegated OAuth2 for:

- `GET /api/connectors/:connectorId/oauth/start`
- `GET /api/connectors/oauth/callback`
- `POST /api/mail-ssot/save`
- `GET /api/mail-ssot/latest`

Graph search is intentionally not used. MailSSOT retrieval scans `Inbox` first, then `SentItems`, and filters self-sent snapshot messages client-side.
