"use strict";

const { BaseConnector } = require("./base_connector");
const { BlueprintError } = require("../errors");
const {
  createConnection,
  getConnectionById,
  updateConnection,
  createMailboxMessage,
  getLatestMailboxMessage,
} = require("../db");
const { createSecret, readSecretPlaintextForServer } = require("../vault/service");
const { logConnectorRequest } = require("../audit");

const MAILBOX_EMAIL_SECRET = "mailbox:identity_email";
const MAILBOX_API_KEY_SECRET = "mailbox:api_key";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());

class MailboxConnector extends BaseConnector {
  constructor() {
    super({
      id: "mailbox",
      label: "Mailbox",
      authType: "apiKey",
    });
  }

  requirements() {
    return {
      scopes: ["mail:send", "mail:read"],
      fields: [
        {
          name: "mailboxEmail",
          type: "text",
          required: true,
          help: "Mailbox identity used for self-sent snapshots",
        },
        {
          name: "apiKey",
          type: "password",
          required: true,
          help: "Provider key/token for mailbox API",
        },
      ],
      docsUrl: "https://docs.blue-print.ai/connectors/mailbox",
    };
  }

  async authorize(input, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const payload = input && typeof input === "object" ? input : {};
    const mailboxEmail = normalizeEmail(payload.mailboxEmail);
    const apiKey = String(payload.apiKey || "").trim();

    if (!isEmail(mailboxEmail)) {
      throw new BlueprintError(400, "validation", "mailboxEmail must be a valid email address");
    }
    if (!apiKey) {
      throw new BlueprintError(400, "validation", "Mailbox apiKey is required");
    }

    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: MAILBOX_EMAIL_SECRET,
      value: mailboxEmail,
    });
    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: MAILBOX_API_KEY_SECRET,
      value: apiKey,
    });

    const requestedScopes = Array.isArray(payload.scopes)
      ? payload.scopes.map((x) => String(x || "")).filter(Boolean)
      : this.requirements().scopes || [];

    const connection = createConnection({
      workspaceId,
      connectorId: this.id,
      status: "active",
      scopes: requestedScopes,
      fields: ["mailboxEmail", "apiKey"],
      createdBy: actorUserId,
    });

    return { connectionId: connection.id };
  }

  async test(connectionId, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    const mailboxEmail = normalizeEmail(
      readSecretPlaintextForServer({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: MAILBOX_EMAIL_SECRET,
      })
    );
    const apiKey = String(
      readSecretPlaintextForServer({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: MAILBOX_API_KEY_SECRET,
      })
    ).trim();

    const looksValid = isEmail(mailboxEmail) && apiKey.length >= 10;
    if (!looksValid) {
      updateConnection(connection.id, { status: "error" });
      return { ok: false, details: "Mailbox credentials appear invalid" };
    }

    updateConnection(connection.id, { status: "active" });
    return { ok: true, details: "Mailbox mock validation succeeded" };
  }

  async request(connectionId, opts, ctx) {
    const started = Date.now();
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    const mailboxEmail = normalizeEmail(
      readSecretPlaintextForServer({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: MAILBOX_EMAIL_SECRET,
      })
    );
    const apiKey = String(
      readSecretPlaintextForServer({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: MAILBOX_API_KEY_SECRET,
      })
    ).trim();
    if (!isEmail(mailboxEmail) || !apiKey) {
      throw new BlueprintError(401, "connector_request_failed", "Mailbox credentials are unavailable");
    }

    const method = String(opts?.method || "GET").toUpperCase();
    const path = String(opts?.path || "/");
    const body = opts?.body && typeof opts.body === "object" ? opts.body : {};
    const rateLimitHeaders = {
      "x-ratelimit-limit": "120",
      "x-ratelimit-remaining": "119",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    };

    let response = null;
    let status = 200;

    if (path === "/mail/ssot/save" && method === "POST") {
      const planId = String(body.planId || "").trim();
      const subject = String(body.subject || "").trim();
      const mailBody = String(body.mailBody || "");
      if (!planId || !mailBody) {
        throw new BlueprintError(400, "validation", "planId and mailBody are required");
      }

      const fromInput = body.from == null ? mailboxEmail : normalizeEmail(body.from);
      const toInput = body.to == null ? mailboxEmail : normalizeEmail(body.to);
      if (fromInput !== mailboxEmail || toInput !== mailboxEmail) {
        throw new BlueprintError(400, "validation", "Mailbox snapshots must be self-sent by the authorized mailbox");
      }

      const message = createMailboxMessage({
        workspaceId,
        connectorId: this.id,
        connectionId,
        mailboxEmail,
        planId,
        from: mailboxEmail,
        to: mailboxEmail,
        subject: subject || `AGENTC MailSSOT ${planId}`,
        body: mailBody,
        meta: body.meta && typeof body.meta === "object" ? body.meta : {},
      });
      response = {
        ok: true,
        connectorId: this.id,
        messageId: message.id,
        savedAt: message.createdAt,
        from: message.from,
        to: message.to,
        mailboxEmail: message.mailboxEmail,
        planId: message.planId,
      };
    } else if (path === "/mail/ssot/latest") {
      const planId = String(body.planId || "").trim();
      if (!planId) {
        throw new BlueprintError(400, "validation", "planId is required");
      }

      const message = getLatestMailboxMessage({
        workspaceId,
        connectorId: this.id,
        connectionId,
        mailboxEmail,
        planId,
      });
      if (!message) {
        response = {
          ok: true,
          connectorId: this.id,
          found: false,
          mailboxEmail,
          planId,
        };
      } else {
        response = {
          ok: true,
          connectorId: this.id,
          found: true,
          mailboxEmail,
          planId,
          messageId: message.id,
          savedAt: message.createdAt,
          subject: message.subject,
          from: message.from,
          to: message.to,
          body: message.body,
          meta: message.meta && typeof message.meta === "object" ? { ...message.meta } : {},
        };
      }
    } else {
      status = 404;
      throw new BlueprintError(404, "connector_request_failed", `Unsupported mailbox path: ${path}`);
    }

    logConnectorRequest({
      workspaceId,
      connectorId: this.id,
      connectionId,
      status,
      latencyMs: Date.now() - started,
      rateLimitHeaders,
      meta: {
        method,
        path,
      },
    });

    return response;
  }
}

module.exports = {
  MailboxConnector,
};
