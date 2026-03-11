process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";
process.env.OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "outlook-client-id-test";
process.env.OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || "outlook-client-secret-test";
process.env.OUTLOOK_REDIRECT_URI =
  process.env.OUTLOOK_REDIRECT_URI || "https://agentc.blueprint.ai/api/connectors/oauth/callback";

const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb, listConnections, findVaultSecretByName } = require("../lib/blueprint/db");
const { loginWithPassword } = require("../lib/blueprint/services/auth_service");
const { deriveKey } = require("../lib/blueprint/security");
const { OAUTH_STATE_TYPE } = require("../lib/blueprint/oauth_state");
const startHandler = require("../api/connectors/[connectorId]/oauth/start.js");
const callbackHandler = require("../api/connectors/oauth/callback.js");

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
});

const base64UrlEncode = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const signExpiredState = () => {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      typ: OAUTH_STATE_TYPE,
      connectorId: "outlook",
      workspaceId: "ws_core",
      userId: "usr_demo",
      iat: 1,
      exp: 2,
    })
  );
  const input = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", deriveKey("jwt")).update(input).digest();
  return `${input}.${base64UrlEncode(signature)}`;
};

const authCookie = () => {
  const out = loginWithPassword({
    email: process.env.BLUEPRINT_DEMO_EMAIL || "demo@blueprint.ai",
    password: process.env.BLUEPRINT_DEMO_PASSWORD || "demo123!",
    ip: "127.0.0.1",
    userAgent: "node-test",
  });
  return `bp_session=${encodeURIComponent(out.token)}`;
};

const makeResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    body: "",
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(payload) {
      this.body = payload == null ? "" : String(payload);
    },
    headers,
  };
};

const callHandler = async (handler, req) => {
  const res = makeResponse();
  await handler(req, res);
  return res;
};

const makeFetchResponse = (status, body, headers = {}) => {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      forEach(fn) {
        for (const [key, value] of Object.entries(normalizedHeaders)) fn(value, key);
      },
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] || null;
      },
    },
    async json() {
      if (body == null || body === "") throw new Error("No JSON body");
      return typeof body === "string" ? JSON.parse(body) : body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body ?? "");
    },
  };
};

test("outlook oauth start redirects and callback creates an active connection", async () => {
  resetBlueprintDb();
  const cookie = authCookie();

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(200, {
        access_token: "access_1",
        refresh_token: "refresh_1",
        scope: "openid offline_access Mail.ReadWrite Mail.Send",
        expires_in: 3600,
      });
    }
    if (href.includes("/me?$select=mail,userPrincipalName")) {
      return makeFetchResponse(200, {
        mail: "bot@blue-print.ai",
        userPrincipalName: "bot@blue-print.ai",
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const startRes = await callHandler(startHandler, {
    method: "GET",
    url: "/api/connectors/outlook/oauth/start?workspaceId=ws_core",
    query: { connectorId: "outlook", workspaceId: "ws_core" },
    headers: { cookie },
  });

  assert.equal(startRes.statusCode, 302);
  const redirect = String(startRes.getHeader("location") || "");
  assert.equal(redirect.startsWith("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"), true);
  const startUrl = new URL(redirect);
  const state = String(startUrl.searchParams.get("state") || "");
  assert.ok(state);

  const callbackRes = await callHandler(callbackHandler, {
    method: "GET",
    url: `/api/connectors/oauth/callback?state=${encodeURIComponent(state)}&code=oauth_code_1`,
    query: {
      state,
      code: "oauth_code_1",
    },
    headers: {},
  });

  assert.equal(callbackRes.statusCode, 200);
  assert.equal(String(callbackRes.body || "").includes("Connector authorized"), true);
  const connections = listConnections("ws_core").filter((row) => row.connectorId === "outlook");
  assert.equal(connections.length, 1);
  assert.equal(connections[0].status, "active");
  assert.ok(findVaultSecretByName("ws_core", "outlook", "outlook:identity_email"));
  assert.ok(findVaultSecretByName("ws_core", "outlook", "outlook:access_token"));
});

test("oauth start rejects connectors without interactive oauth support", async () => {
  resetBlueprintDb();
  const cookie = authCookie();

  const res = await callHandler(startHandler, {
    method: "GET",
    url: "/api/connectors/fasthosts/oauth/start?workspaceId=ws_core",
    query: { connectorId: "fasthosts", workspaceId: "ws_core" },
    headers: { cookie },
  });

  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(String(res.body || "{}"));
  assert.equal(payload.error, "connector_oauth_not_supported");
});

test("oauth callback rejects invalid or expired state", async () => {
  resetBlueprintDb();

  const res = await callHandler(callbackHandler, {
    method: "GET",
    url: "/api/connectors/oauth/callback?state=invalid&code=oauth_code_2",
    query: {
      state: signExpiredState(),
      code: "oauth_code_2",
    },
    headers: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(String(res.body || "").includes("Connector authorization failed"), true);
  assert.equal(listConnections("ws_core").filter((row) => row.connectorId === "outlook").length, 0);
});

test("oauth callback surfaces token exchange failures without creating a connection", async () => {
  resetBlueprintDb();
  const cookie = authCookie();

  const startRes = await callHandler(startHandler, {
    method: "GET",
    url: "/api/connectors/outlook/oauth/start?workspaceId=ws_core",
    query: { connectorId: "outlook", workspaceId: "ws_core" },
    headers: { cookie },
  });
  const redirect = String(startRes.getHeader("location") || "");
  const state = new URL(redirect).searchParams.get("state");

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(400, {
        error: "invalid_grant",
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const callbackRes = await callHandler(callbackHandler, {
    method: "GET",
    url: `/api/connectors/oauth/callback?state=${encodeURIComponent(state)}&code=oauth_code_3`,
    query: {
      state,
      code: "oauth_code_3",
    },
    headers: {},
  });

  assert.equal(callbackRes.statusCode, 502);
  assert.equal(String(callbackRes.body || "").includes("Connector authorization failed"), true);
  assert.equal(listConnections("ws_core").filter((row) => row.connectorId === "outlook").length, 0);
});
