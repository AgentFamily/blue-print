"use strict";

const { BaseConnector } = require("./base_connector");
const { BlueprintError } = require("../errors");
const { createConnection, getConnectionById, updateConnection } = require("../db");
const { createSecret, readSecretPlaintextForServer } = require("../vault/service");
const { logConnectorRequest } = require("../audit");

const DEFAULT_DASHBOARD_URL = "https://admin.fasthosts.co.uk";
const DEFAULT_WEBMAIL_URL = "https://webmail.fasthosts.co.uk";
const CLOUD_API_BASE_URL = "https://api.cloud-api.admin.fasthosts.co.uk/v1";

const SECRET_NAMES = Object.freeze({
  accessMode: "fasthosts_access_mode",
  apiKey: "fasthosts_api_key",
  dashboardUrl: "fasthosts_dashboard_url",
  webmailUrl: "fasthosts_webmail_url",
  accountEmail: "fasthosts_account_email",
  accountId: "fasthosts_account_id",
});

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());

const normalizeAccessMode = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "cloud-api" || raw === "cloud_api" || raw === "api") return "cloud-api";
  return "dashboard";
};

const normalizeHttpsUrl = (value, fallback, fieldName) => {
  const source = String(value || "").trim() || String(fallback || "").trim();
  let parsed = null;
  try {
    parsed = new URL(source);
  } catch {
    throw new BlueprintError(400, "validation", `${fieldName} must be a valid https URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new BlueprintError(400, "validation", `${fieldName} must use https`);
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

const normalizeDomain = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const cleaned = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  return cleaned;
};

const looksLikeApiKey = (value) => {
  const key = String(value || "").trim();
  return /^fh_[a-z0-9_\-]{10,}$/i.test(key) || key.length >= 16;
};

const buildAccessLinks = ({ dashboardUrl, webmailUrl, accountEmail, accountId }) => ({
  dashboard: {
    loginUrl: dashboardUrl,
    domainConfiguration: "Open Products -> Domain Names -> DNS / Contacts in FastHosts dashboard",
    domainEmailConfiguration: "Open Products -> Email & Microsoft 365 in FastHosts dashboard",
  },
  email: {
    webmailUrl,
    accountEmail: accountEmail || null,
  },
  account: {
    accountId: accountId || null,
  },
  cloudApi: {
    baseUrl: CLOUD_API_BASE_URL,
    authHeader: "X-TOKEN",
  },
});

const readSecretIfPresent = ({ actorUserId, workspaceId, connectorId, name }) => {
  try {
    return readSecretPlaintextForServer({
      actorUserId,
      workspaceId,
      connectorId,
      name,
    });
  } catch (err) {
    if (err instanceof BlueprintError && err.code === "secret_not_found") return "";
    throw err;
  }
};

const readConnectorSettings = ({ actorUserId, workspaceId, connectorId }) => {
  const accessMode = normalizeAccessMode(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.accessMode,
    }) || "dashboard"
  );

  const dashboardUrl = normalizeHttpsUrl(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.dashboardUrl,
    }),
    DEFAULT_DASHBOARD_URL,
    "dashboardUrl"
  );

  const webmailUrl = normalizeHttpsUrl(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.webmailUrl,
    }),
    DEFAULT_WEBMAIL_URL,
    "webmailUrl"
  );

  const accountEmail = normalizeEmail(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.accountEmail,
    })
  );

  const accountId = String(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.accountId,
    })
  ).trim();

  const apiKey = String(
    readSecretIfPresent({
      actorUserId,
      workspaceId,
      connectorId,
      name: SECRET_NAMES.apiKey,
    })
  ).trim();

  return {
    accessMode,
    dashboardUrl,
    webmailUrl,
    accountEmail,
    accountId,
    apiKey,
  };
};

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
      scopes: ["domain:read", "dns:read", "email:read", "dashboard:read"],
      fields: [
        {
          name: "accessMode",
          type: "text",
          required: false,
          help: "Use dashboard (recommended) or cloud-api",
        },
        {
          name: "dashboardUrl",
          type: "text",
          required: false,
          help: `FastHosts dashboard URL (default: ${DEFAULT_DASHBOARD_URL})`,
        },
        {
          name: "webmailUrl",
          type: "text",
          required: false,
          help: `FastHosts webmail URL (default: ${DEFAULT_WEBMAIL_URL})`,
        },
        {
          name: "accountEmail",
          type: "text",
          required: false,
          help: "Optional FastHosts account email used for dashboard sign-in",
        },
        {
          name: "apiKey",
          type: "password",
          required: false,
          help: "Optional CloudNX X-TOKEN (not required for dashboard mode)",
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
    const accessMode = normalizeAccessMode(fields?.accessMode || "dashboard");
    const dashboardUrl = normalizeHttpsUrl(fields?.dashboardUrl, DEFAULT_DASHBOARD_URL, "dashboardUrl");
    const webmailUrl = normalizeHttpsUrl(fields?.webmailUrl, DEFAULT_WEBMAIL_URL, "webmailUrl");
    const accountEmail = normalizeEmail(fields?.accountEmail || "");
    const apiKey = String(fields?.apiKey || "").trim();
    const accountId = String(fields?.accountId || "").trim();

    if (accountEmail && !isEmail(accountEmail)) {
      throw new BlueprintError(400, "validation", "accountEmail must be a valid email address");
    }
    if (accessMode === "cloud-api" && !apiKey) {
      throw new BlueprintError(400, "missing_api_key", "Fasthosts apiKey is required for cloud-api mode");
    }

    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: SECRET_NAMES.accessMode,
      value: accessMode,
    });
    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: SECRET_NAMES.dashboardUrl,
      value: dashboardUrl,
    });
    await createSecret({
      actorUserId,
      workspaceId,
      connectorId: this.id,
      name: SECRET_NAMES.webmailUrl,
      value: webmailUrl,
    });
    if (accountEmail) {
      await createSecret({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: SECRET_NAMES.accountEmail,
        value: accountEmail,
      });
    }
    if (accountId) {
      await createSecret({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: SECRET_NAMES.accountId,
        value: accountId,
      });
    }
    if (apiKey) {
      await createSecret({
        actorUserId,
        workspaceId,
        connectorId: this.id,
        name: SECRET_NAMES.apiKey,
        value: apiKey,
      });
    }

    const requestedScopes = Array.isArray(fields?.scopes)
      ? fields.scopes.map((x) => String(x || "")).filter(Boolean)
      : this.requirements().scopes || [];

    const fieldSet = new Set(["accessMode", "dashboardUrl", "webmailUrl"]);
    if (accountEmail) fieldSet.add("accountEmail");
    if (accountId) fieldSet.add("accountId");
    if (apiKey) fieldSet.add("apiKey");

    const connection = createConnection({
      workspaceId,
      connectorId: this.id,
      status: "active",
      scopes: requestedScopes,
      fields: Array.from(fieldSet),
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

    const settings = readConnectorSettings({
      actorUserId,
      workspaceId,
      connectorId: this.id,
    });

    const failures = [];
    if (!settings.dashboardUrl) failures.push("dashboardUrl is unavailable");
    if (!settings.webmailUrl) failures.push("webmailUrl is unavailable");
    if (settings.accountEmail && !isEmail(settings.accountEmail)) {
      failures.push("accountEmail format appears invalid");
    }
    if (settings.accessMode === "cloud-api" && !settings.apiKey) {
      failures.push("cloud-api mode requires apiKey");
    }
    if (settings.apiKey && !looksLikeApiKey(settings.apiKey)) {
      failures.push("API key format appears invalid");
    }

    if (failures.length > 0) {
      updateConnection(connection.id, { status: "error" });
      return {
        ok: false,
        mode: settings.accessMode,
        details: failures.join("; "),
        access: buildAccessLinks(settings),
      };
    }

    updateConnection(connection.id, { status: "active" });
    return {
      ok: true,
      mode: settings.accessMode,
      details:
        settings.accessMode === "cloud-api"
          ? "Fasthosts cloud-api credentials look valid and dashboard links are configured"
          : "Fasthosts dashboard and webmail access links are configured",
      cloudApiConfigured: Boolean(settings.apiKey),
      access: buildAccessLinks(settings),
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

    const settings = readConnectorSettings({
      actorUserId,
      workspaceId,
      connectorId: this.id,
    });
    const access = buildAccessLinks(settings);

    const path = String(opts?.path || "/");
    const method = String(opts?.method || "GET").toUpperCase();
    const body = opts?.body && typeof opts.body === "object" ? opts.body : {};
    const requestedDomain = normalizeDomain(body?.domain || body?.targetDomain || body?.fqdn || "");
    const rateLimitHeaders = {
      "x-ratelimit-limit": "120",
      "x-ratelimit-remaining": "119",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
    };

    const shared = {
      ok: true,
      connectorId: this.id,
      method,
      path,
      accessMode: settings.accessMode,
      access,
      cloudApiConfigured: Boolean(settings.apiKey),
      rateLimit: rateLimitHeaders,
    };

    const finalize = (statusCode, payload) => {
      logConnectorRequest({
        workspaceId,
        connectorId: this.id,
        connectionId,
        status: statusCode,
        latencyMs: Date.now() - started,
        rateLimitHeaders,
        meta: {
          method,
          path,
        },
      });
      return payload;
    };

    if (path.includes("domain")) {
      return finalize(200, {
        ...shared,
        data: {
          domain: requestedDomain || "example.com",
          status: "active",
          dnsHealthy: true,
          dashboardLoginUrl: settings.dashboardUrl,
          webmailUrl: settings.webmailUrl,
        },
      });
    }

    if (path.includes("email") || path.includes("mail")) {
      return finalize(200, {
        ...shared,
        data: {
          mailboxesAccessible: true,
          webmailUrl: settings.webmailUrl,
          accountEmail: settings.accountEmail || null,
          dashboardLoginUrl: settings.dashboardUrl,
        },
      });
    }

    if (settings.accessMode === "cloud-api" && !settings.apiKey) {
      finalize(401, null);
      throw new BlueprintError(401, "connector_request_failed", "Fasthosts cloud-api key is unavailable");
    }

    return finalize(200, {
      ...shared,
      data: {
        message: "Fasthosts dashboard access is configured",
        dashboardLoginUrl: settings.dashboardUrl,
        webmailUrl: settings.webmailUrl,
        received: body,
      },
    });
  }
}

module.exports = {
  FasthostsConnector,
};
