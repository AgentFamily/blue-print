"use strict";

const { BaseConnector } = require("./base_connector");
const { BlueprintError } = require("../errors");
const { createConnection, getConnectionById, updateConnection } = require("../db");
const { createSecret, readSecretPlaintextForServer } = require("../vault/service");
const { logConnectorRequest } = require("../audit");

class MockApiConnector extends BaseConnector {
  constructor(definition) {
    super({
      id: definition.id,
      label: definition.label,
      authType: definition.authType || "apiKey",
    });
    this.definition = {
      scopes: [],
      fields: [],
      docsUrl: "",
      ...definition,
    };
  }

  requirements() {
    return {
      scopes: Array.isArray(this.definition.scopes) ? this.definition.scopes.slice() : [],
      fields: Array.isArray(this.definition.fields)
        ? this.definition.fields.map((field) => ({
            name: String(field.name || "").trim(),
            type: String(field.type || "text"),
            required: Boolean(field.required),
            help: String(field.help || ""),
          }))
        : [],
      docsUrl: String(this.definition.docsUrl || "").trim(),
    };
  }

  secretName(fieldName) {
    return `${this.id}:${String(fieldName || "").trim()}`;
  }

  requiredFields() {
    return this.requirements().fields.filter((field) => field.required);
  }

  async authorize(input, ctx) {
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const payload = input && typeof input === "object" ? input : {};
    const reqs = this.requirements();

    for (const field of this.requiredFields()) {
      const value = String(payload?.[field.name] || "").trim();
      if (!value) {
        throw new BlueprintError(400, "missing_field", `${this.label} requires field '${field.name}'`);
      }
    }

    const persistedFields = [];
    for (const field of reqs.fields) {
      const value = String(payload?.[field.name] || "").trim();
      if (!value) continue;
      await createSecret({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: this.secretName(field.name),
        value,
      });
      persistedFields.push(field.name);
    }

    const requestedScopes = Array.isArray(payload?.scopes)
      ? payload.scopes.map((x) => String(x || "")).filter(Boolean)
      : reqs.scopes;

    const connection = createConnection({
      workspaceId,
      connectorId: this.id,
      status: "active",
      scopes: requestedScopes,
      fields: persistedFields,
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

    const reqs = this.requirements();
    const missing = [];
    const weak = [];
    for (const field of this.requiredFields()) {
      let value = "";
      try {
        value = readSecretPlaintextForServer({
          actorUserId,
          workspaceId,
          connectorId: this.id,
          name: this.secretName(field.name),
        });
      } catch {
        value = "";
      }

      if (!value) {
        missing.push(field.name);
        continue;
      }
      if ((field.type === "password" || field.type === "token") && value.length < 10) {
        weak.push(field.name);
      }
    }

    if (missing.length > 0 || weak.length > 0) {
      updateConnection(connection.id, { status: "error" });
      const details = [
        missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
        weak.length > 0 ? `too short: ${weak.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return {
        ok: false,
        details: `${this.label} test failed (${details || "invalid credentials"})`,
      };
    }

    updateConnection(connection.id, { status: "active" });
    return {
      ok: true,
      details: `${this.label} mock validation succeeded`,
    };
  }

  async request(connectionId, opts, ctx) {
    const started = Date.now();
    const workspaceId = String(ctx?.workspaceId || "");
    const actorUserId = String(ctx?.actorUserId || "");
    const connection = getConnectionById(connectionId);

    if (!connection || connection.connectorId !== this.id || connection.workspaceId !== workspaceId) {
      throw new BlueprintError(404, "connection_not_found", "Connection not found for workspace");
    }

    // Ensure server-only secret access path is exercised.
    for (const field of this.requiredFields()) {
      readSecretPlaintextForServer({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: this.secretName(field.name),
      });
    }

    const path = String(opts?.path || "/");
    const method = String(opts?.method || "GET").toUpperCase();
    const status = 200;

    const rateLimitHeaders = {
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "99",
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

    return {
      ok: true,
      connectorId: this.id,
      provider: this.label,
      method,
      path,
      data: {
        summary: `${this.label} mocked API response`,
        input: opts?.body || null,
      },
      rateLimit: rateLimitHeaders,
    };
  }
}

module.exports = {
  MockApiConnector,
};
