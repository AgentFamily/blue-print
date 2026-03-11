"use strict";

const { BlueprintError } = require("../errors");

const OUTLOOK_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const OUTLOOK_AUTHORIZE_URL = `${OUTLOOK_AUTHORITY}/authorize`;
const OUTLOOK_TOKEN_URL = `${OUTLOOK_AUTHORITY}/token`;
const OUTLOOK_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_OUTLOOK_SCOPES = ["openid", "email", "profile", "offline_access", "Mail.ReadWrite", "Mail.Send"];

const normalizeScopeList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getOutlookOauthConfig = () => {
  const clientId = String(process.env.OUTLOOK_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.OUTLOOK_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.OUTLOOK_REDIRECT_URI || "").trim();
  const scopes = normalizeScopeList(process.env.OUTLOOK_OAUTH_SCOPES);
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: scopes.length ? scopes : DEFAULT_OUTLOOK_SCOPES.slice(),
  };
};

const ensureOutlookOauthConfig = () => {
  const config = getOutlookOauthConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new BlueprintError(
      500,
      "outlook_oauth_not_configured",
      "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, and OUTLOOK_REDIRECT_URI must be configured"
    );
  }
  return config;
};

const getFetch = () => {
  if (typeof global.fetch !== "function") {
    throw new BlueprintError(500, "fetch_unavailable", "global.fetch is required for the Outlook connector");
  }
  return global.fetch.bind(global);
};

const buildAuthorizeUrl = ({ state }) => {
  const config = ensureOutlookOauthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: config.scopes.join(" "),
    state: String(state || ""),
  });
  return `${OUTLOOK_AUTHORIZE_URL}?${params.toString()}`;
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const parseErrorBody = async (response) => {
  const json = await safeJson(response);
  if (json) return json;
  try {
    return await response.text();
  } catch {
    return "";
  }
};

const fetchToken = async (params, errorCode) => {
  const config = ensureOutlookOauthConfig();
  const fetchImpl = getFetch();
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    ...params,
  });

  let response = null;
  try {
    response = await fetchImpl(OUTLOOK_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    throw new BlueprintError(502, errorCode, "Outlook token request failed", {
      cause: String(err?.message || err),
    });
  }

  const body = await safeJson(response);
  if (!response.ok || !body?.access_token) {
    throw new BlueprintError(502, errorCode, "Outlook token exchange failed", {
      status: Number(response.status || 0),
      body: body || (await parseErrorBody(response)),
    });
  }

  const expiresIn = Number(body.expires_in || 0);
  return {
    accessToken: String(body.access_token || ""),
    refreshToken: String(body.refresh_token || ""),
    scope: String(body.scope || config.scopes.join(" ")),
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn || 3600) * 1000).toISOString(),
  };
};

const exchangeCodeForTokens = async ({ code }) =>
  fetchToken(
    {
      grant_type: "authorization_code",
      code: String(code || "").trim(),
      scope: ensureOutlookOauthConfig().scopes.join(" "),
    },
    "outlook_oauth_exchange_failed"
  );

const refreshAccessToken = async ({ refreshToken }) =>
  fetchToken(
    {
      grant_type: "refresh_token",
      refresh_token: String(refreshToken || "").trim(),
      scope: ensureOutlookOauthConfig().scopes.join(" "),
    },
    "outlook_oauth_refresh_failed"
  );

const graphRequest = async ({ accessToken, method = "GET", path, headers = {}, body }) => {
  const fetchImpl = getFetch();
  const url = String(path || "").startsWith("https://")
    ? String(path || "")
    : `${OUTLOOK_GRAPH_BASE}${String(path || "").startsWith("/") ? String(path || "") : `/${String(path || "")}`}`;

  const requestHeaders = {
    authorization: `Bearer ${String(accessToken || "").trim()}`,
    ...headers,
  };
  if (body !== undefined && body !== null && !requestHeaders["content-type"]) {
    requestHeaders["content-type"] = "application/json";
  }

  let response = null;
  try {
    response = await fetchImpl(url, {
      method: String(method || "GET").toUpperCase(),
      headers: requestHeaders,
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch (err) {
    throw new BlueprintError(502, "outlook_graph_failed", "Outlook Graph request failed", {
      cause: String(err?.message || err),
      path: String(path || ""),
    });
  }

  const responseBody = response.status === 204 ? null : await safeJson(response);
  if (!response.ok) {
    throw new BlueprintError(502, "outlook_graph_failed", "Outlook Graph request failed", {
      status: Number(response.status || 0),
      path: String(path || ""),
      body: responseBody || (await parseErrorBody(response)),
    });
  }

  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[String(key || "").toLowerCase()] = value;
  });
  return {
    status: Number(response.status || 0),
    headers: responseHeaders,
    body: responseBody,
  };
};

const tokenExpiresSoon = (expiresAt) => {
  const ms = Date.parse(String(expiresAt || ""));
  return !Number.isFinite(ms) || ms <= Date.now() + REFRESH_WINDOW_MS;
};

const normalizeOutlookEmail = (value) => String(value || "").trim().toLowerCase();

module.exports = {
  DEFAULT_OUTLOOK_SCOPES,
  OUTLOOK_AUTHORIZE_URL,
  OUTLOOK_TOKEN_URL,
  OUTLOOK_GRAPH_BASE,
  buildAuthorizeUrl,
  ensureOutlookOauthConfig,
  exchangeCodeForTokens,
  refreshAccessToken,
  graphRequest,
  tokenExpiresSoon,
  normalizeOutlookEmail,
};
