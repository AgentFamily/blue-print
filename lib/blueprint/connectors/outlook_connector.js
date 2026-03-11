"use strict";

const { BaseConnector } = require("./base_connector");
const { BlueprintError } = require("../errors");
const { createConnection, getConnectionById, updateConnection } = require("../db");
const { createSecret, readSecretPlaintextForServer } = require("../vault/service");
const { logConnectorRequest } = require("../audit");
const { parseEnvelopeBody } = require("../mail_ssot_payload");
const {
  buildAuthorizeUrl,
  ensureOutlookOauthConfig,
  exchangeCodeForTokens,
  refreshAccessToken,
  graphRequest,
  tokenExpiresSoon,
  normalizeOutlookEmail,
} = require("./outlook_oauth");

const OUTLOOK_IDENTITY_EMAIL_SECRET = "outlook:identity_email";
const OUTLOOK_ACCESS_TOKEN_SECRET = "outlook:access_token";
const OUTLOOK_REFRESH_TOKEN_SECRET = "outlook:refresh_token";
const OUTLOOK_SCOPE_SECRET = "outlook:scope";
const OUTLOOK_EXPIRES_AT_SECRET = "outlook:expires_at";

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());

const getGraphIdentityEmail = (profile) =>
  normalizeOutlookEmail(profile?.mail || profile?.userPrincipalName || profile?.user?.principalName || "");

const extractMailboxAddress = (value) =>
  normalizeOutlookEmail(value?.emailAddress?.address || value?.address || value?.mail || "");

const toRateLimitHeaders = (headers) => {
  const out = {};
  for (const key of ["retry-after", "request-id", "client-request-id", "x-ms-ags-diagnostic"]) {
    if (headers?.[key]) out[key] = headers[key];
  }
  return out;
};

const bodyTextFromMessage = (message) => {
  const contentType = String(message?.body?.contentType || "").toLowerCase();
  const content = String(message?.body?.content || "");
  if (contentType !== "html") return content;
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
};

const getErrorStatus = (err) => {
  const detailStatus = Number(err?.details?.status || 0);
  if (detailStatus > 0) return detailStatus;
  const topStatus = Number(err?.status || 0);
  if (topStatus > 0) return topStatus;
  return 500;
};

const isConnectionAuthError = (err) =>
  err instanceof BlueprintError &&
  (err.code === "secret_not_found" ||
    err.code === "outlook_oauth_exchange_failed" ||
    err.code === "outlook_oauth_refresh_failed" ||
    (err.code === "outlook_graph_failed" && [401, 403].includes(Number(err?.details?.status || 0))));

class OutlookConnector extends BaseConnector {
  constructor() {
    super({
      id: "outlook",
      label: "Outlook",
      authType: "oauth2",
    });
  }

  requirements() {
    return {
      scopes: ["mail:send", "mail:read"],
      fields: [],
      docsUrl: "https://learn.microsoft.com/en-us/graph/users-you-can-reach",
    };
  }

  async beginAuthorize(ctx) {
    const state = String(ctx?.state || "").trim();
    if (!state) {
      throw new BlueprintError(400, "invalid_oauth_state", "OAuth state is required");
    }
    ensureOutlookOauthConfig();
    return {
      redirect: buildAuthorizeUrl({ state }),
    };
  }

  async authorize(input, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const code = String(input?.code || "").trim();
    if (!code) {
      throw new BlueprintError(400, "validation", "Outlook OAuth callback code is required");
    }

    const tokens = await exchangeCodeForTokens({ code });
    const profile = await graphRequest({
      accessToken: tokens.accessToken,
      path: "/me?$select=mail,userPrincipalName",
    });
    const identityEmail = getGraphIdentityEmail(profile.body);
    if (!isEmail(identityEmail) || !tokens.refreshToken) {
      throw new BlueprintError(400, "validation", "Outlook account did not return a usable mailbox identity");
    }

    await this.storeOauthSecrets({
      actorUserId,
      workspaceId,
      identityEmail,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
    });

    const connection = createConnection({
      workspaceId,
      connectorId: this.id,
      status: "active",
      scopes: this.requirements().scopes || [],
      fields: [],
      createdBy: actorUserId,
    });

    return { connectionId: connection.id };
  }

  async test(connectionId, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    try {
      const auth = await this.getAuthorizedMailbox(connection.id, ctx);
      await graphRequest({
        accessToken: auth.accessToken,
        path: "/me/mailFolders/inbox/messages?$top=1&$select=id",
      });
      updateConnection(connection.id, { status: "active" });
      return { ok: true, details: "Outlook Graph mailbox validation succeeded" };
    } catch (err) {
      updateConnection(connection.id, { status: "error" });
      return { ok: false, details: String(err?.message || err) };
    }
  }

  async request(connectionId, opts, ctx) {
    const started = Date.now();
    const workspaceId = String(ctx?.workspaceId || "");
    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    const method = String(opts?.method || "GET").toUpperCase();
    const path = String(opts?.path || "/");
    let rateLimitHeaders = {};
    try {
      const auth = await this.getAuthorizedMailbox(connection.id, ctx);
      let response = null;

      if (path === "/mail/ssot/save" && method === "POST") {
        response = await this.saveMailSsotMessage(auth, opts?.body);
      } else if (path === "/mail/ssot/latest" && method === "GET") {
        response = await this.getLatestMailSsotMessage(auth, opts?.body);
      } else {
        throw new BlueprintError(404, "connector_request_failed", `Unsupported Outlook path: ${path}`);
      }

      rateLimitHeaders = toRateLimitHeaders(response?.rateLimit || {});
      updateConnection(connection.id, { status: "active" });
      logConnectorRequest({
        workspaceId,
        connectorId: this.id,
        connectionId,
        status: 200,
        latencyMs: Date.now() - started,
        rateLimitHeaders,
        meta: {
          method,
          path,
        },
      });

      return response.payload;
    } catch (err) {
      if (isConnectionAuthError(err)) {
        updateConnection(connection.id, { status: "error" });
      }
      logConnectorRequest({
        workspaceId,
        connectorId: this.id,
        connectionId,
        status: getErrorStatus(err),
        latencyMs: Date.now() - started,
        rateLimitHeaders,
        meta: {
          method,
          path,
          error: String(err?.code || err?.message || "connector_request_failed"),
        },
      });
      throw err;
    }
  }

  async storeOauthSecrets({ actorUserId, workspaceId, identityEmail, accessToken, refreshToken, scope, expiresAt }) {
    const rows = [
      [OUTLOOK_IDENTITY_EMAIL_SECRET, identityEmail],
      [OUTLOOK_ACCESS_TOKEN_SECRET, accessToken],
      [OUTLOOK_REFRESH_TOKEN_SECRET, refreshToken],
      [OUTLOOK_SCOPE_SECRET, scope],
      [OUTLOOK_EXPIRES_AT_SECRET, expiresAt],
    ];
    for (const [name, value] of rows) {
      await createSecret({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name,
        value,
      });
    }
  }

  loadOauthSecrets({ actorUserId, workspaceId }) {
    return {
      identityEmail: normalizeOutlookEmail(
        readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: OUTLOOK_IDENTITY_EMAIL_SECRET,
        })
      ),
      accessToken: String(
        readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: OUTLOOK_ACCESS_TOKEN_SECRET,
        })
      ).trim(),
      refreshToken: String(
        readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: OUTLOOK_REFRESH_TOKEN_SECRET,
        })
      ).trim(),
      scope: String(
        readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: OUTLOOK_SCOPE_SECRET,
        })
      ).trim(),
      expiresAt: String(
        readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: OUTLOOK_EXPIRES_AT_SECRET,
        })
      ).trim(),
    };
  }

  async getAuthorizedMailbox(connectionId, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    const secrets = this.loadOauthSecrets({ actorUserId, workspaceId });
    if (!isEmail(secrets.identityEmail) || !secrets.accessToken) {
      throw new BlueprintError(401, "connector_request_failed", "Outlook credentials are unavailable");
    }

    if (!tokenExpiresSoon(secrets.expiresAt)) {
      return secrets;
    }
    if (!secrets.refreshToken) {
      throw new BlueprintError(401, "connector_request_failed", "Outlook refresh token is unavailable");
    }

    const refreshed = await refreshAccessToken({ refreshToken: secrets.refreshToken });
    const next = {
      identityEmail: secrets.identityEmail,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || secrets.refreshToken,
      scope: refreshed.scope || secrets.scope,
      expiresAt: refreshed.expiresAt,
    };
    await this.storeOauthSecrets({
      actorUserId,
      workspaceId,
      ...next,
    });
    return next;
  }

  async saveMailSsotMessage(auth, body) {
    const payload = body && typeof body === "object" ? body : {};
    const planId = String(payload.planId || "").trim();
    const subject = String(payload.subject || "").trim();
    const mailBody = String(payload.mailBody || "");
    if (!planId || !mailBody || !subject) {
      throw new BlueprintError(400, "validation", "planId, subject, and mailBody are required");
    }

    const fromInput = payload.from == null ? auth.identityEmail : normalizeOutlookEmail(payload.from);
    const toInput = payload.to == null ? auth.identityEmail : normalizeOutlookEmail(payload.to);
    if (fromInput !== auth.identityEmail || toInput !== auth.identityEmail) {
      throw new BlueprintError(400, "validation", "Mailbox snapshots must be self-sent by the authorized mailbox");
    }

    const created = await graphRequest({
      accessToken: auth.accessToken,
      method: "POST",
      path: "/me/messages",
      headers: {
        Prefer: 'IdType="ImmutableId"',
      },
      body: {
        subject,
        body: {
          contentType: "Text",
          content: mailBody,
        },
        toRecipients: [
          {
            emailAddress: {
              address: auth.identityEmail,
            },
          },
        ],
      },
    });

    const messageId = String(created?.body?.id || "").trim();
    if (!messageId) {
      throw new BlueprintError(502, "outlook_graph_failed", "Outlook draft response did not include a message id");
    }

    const sent = await graphRequest({
      accessToken: auth.accessToken,
      method: "POST",
      path: `/me/messages/${encodeURIComponent(messageId)}/send`,
      headers: {
        Prefer: 'IdType="ImmutableId"',
      },
    });

    return {
      rateLimit: { ...created.headers, ...sent.headers },
      payload: {
        ok: true,
        connectorId: this.id,
        messageId,
        savedAt: String(created?.body?.createdDateTime || new Date().toISOString()),
        from: auth.identityEmail,
        to: auth.identityEmail,
        mailboxEmail: auth.identityEmail,
        planId,
      },
    };
  }

  async getLatestMailSsotMessage(auth, body) {
    const payload = body && typeof body === "object" ? body : {};
    const planId = String(payload.planId || "").trim();
    if (!planId) {
      throw new BlueprintError(400, "validation", "planId is required");
    }

    let rateLimit = {};
    for (const folderId of ["inbox", "sentitems"]) {
      const response = await graphRequest({
        accessToken: auth.accessToken,
        path:
          `/me/mailFolders/${folderId}/messages` +
          "?$top=50&$orderby=receivedDateTime%20desc" +
          "&$select=id,subject,body,from,toRecipients,receivedDateTime,createdDateTime",
        headers: {
          Prefer: 'outlook.body-content-type="text"',
        },
      });
      rateLimit = response.headers || {};
      const messages = Array.isArray(response?.body?.value) ? response.body.value : [];
      const subjectPrefix = `AGENTC MailSSOT ${planId} `;

      for (const message of messages) {
        if (extractMailboxAddress(message?.from) !== auth.identityEmail) continue;
        if (!Array.isArray(message?.toRecipients)) continue;
        if (!message.toRecipients.some((recipient) => extractMailboxAddress(recipient) === auth.identityEmail)) {
          continue;
        }
        if (!String(message?.subject || "").startsWith(subjectPrefix)) continue;

        const messageBody = bodyTextFromMessage(message);
        try {
          parseEnvelopeBody(messageBody);
        } catch {
          continue;
        }

        return {
          rateLimit,
          payload: {
            ok: true,
            connectorId: this.id,
            found: true,
            mailboxEmail: auth.identityEmail,
            planId,
            messageId: String(message?.id || ""),
            savedAt: String(message?.receivedDateTime || message?.createdDateTime || ""),
            subject: String(message?.subject || ""),
            from: auth.identityEmail,
            to: auth.identityEmail,
            body: messageBody,
            meta: {
              folderId,
            },
          },
        };
      }
    }

    return {
      rateLimit,
      payload: {
        ok: true,
        connectorId: this.id,
        found: false,
        mailboxEmail: auth.identityEmail,
        planId,
      },
    };
  }
}

module.exports = {
  OutlookConnector,
  OUTLOOK_IDENTITY_EMAIL_SECRET,
  OUTLOOK_ACCESS_TOKEN_SECRET,
  OUTLOOK_REFRESH_TOKEN_SECRET,
  OUTLOOK_SCOPE_SECRET,
  OUTLOOK_EXPIRES_AT_SECRET,
};
