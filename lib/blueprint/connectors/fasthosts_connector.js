"use strict";

const { BaseConnector } = require("./base_connector");
const { BlueprintError } = require("../errors");
const { createConnection, getConnectionById, updateConnection } = require("../db");
const { createSecret, readSecretPlaintextForServer } = require("../vault/service");
const { logConnectorRequest } = require("../audit");

class FasthostsConnector extends BaseConnector {
  constructor() {
    super({
      id: "fasthosts",
      label: "Fasthosts",
      authType: "apiKey",
    });
  }

  requirements() {
    return {
      scopes: ["domain:read", "dns:read"],
      fields: [
        {
          name: "apiKey",
          type: "password",
          required: true,
          help: "Fasthosts API key",
        },
        {
          name: "accountId",
          type: "text",
          required: false,
          help: "Optional account identifier",
        },
      ],
      docsUrl: "https://www.fasthosts.co.uk/help",
    };
  }

  async authorize(input, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const fields = input && typeof input === "object" ? input : {};
    const apiKey = String(fields?.apiKey || "").trim();

    if (!apiKey) {
      throw new BlueprintError(400, "missing_api_key", "Fasthosts apiKey is required");
    }

    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: "fasthosts_api_key",
      value: apiKey,
    });

    const requestedScopes = Array.isArray(fields?.scopes)
      ? fields.scopes.map((x) => String(x || "")).filter(Boolean)
      : this.requirements().scopes || [];

    const connection = createConnection({
      workspaceId,
      connectorId: this.id,
      status: "active",
      scopes: requestedScopes,
      fields: ["apiKey"],
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

    const apiKey = readSecretPlaintextForServer({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: "fasthosts_api_key",
    });

    const looksValid = /^fh_[a-z0-9_\-]{10,}$/i.test(apiKey) || apiKey.length >= 16;
    if (!looksValid) {
      updateConnection(connection.id, { status: "error" });
      return { ok: false, details: "API key format appears invalid" };
    }

    updateConnection(connection.id, { status: "active" });
    return { ok: true, details: "Fasthosts mock validation succeeded" };
  }

  async request(connectionId, opts, ctx) {
    const started = Date.now();
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");

    const connection = getConnectionById(connectionId);
    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    const apiKey = readSecretPlaintextForServer({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: "fasthosts_api_key",
    });

    const path = String(opts?.path || "/");
    const method = String(opts?.method || "GET").toUpperCase();
    const status = apiKey ? 200 : 401;

    const rateLimitHeaders = {
      "x-ratelimit-limit": "120",
      "x-ratelimit-remaining": "119",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    };

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

    if (status !== 200) {
      throw new BlueprintError(401, "connector_request_failed", "Fasthosts request failed (mock)");
    }

    return {
      ok: true,
      connectorId: this.id,
      method,
      path,
      data: path.includes("domain")
        ? { domain: "example.com", status: "active", dnsHealthy: true }
        : { message: "Fasthosts mock response", received: opts?.body || null },
      rateLimit: rateLimitHeaders,
    };
  }
}

module.exports = {
  FasthostsConnector,
};
