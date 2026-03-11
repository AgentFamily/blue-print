process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";
process.env.OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "outlook-client-id-test";
process.env.OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || "outlook-client-secret-test";
process.env.OUTLOOK_REDIRECT_URI =
  process.env.OUTLOOK_REDIRECT_URI || "https://agentc.blueprint.ai/api/connectors/oauth/callback";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { loginWithPassword } = require("../lib/blueprint/services/auth_service");
const { authorizeConnector } = require("../lib/blueprint/services/connector_service");
const { encodeEnvelopeBody } = require("../lib/blueprint/mail_ssot_payload");
const saveHandler = require("../api/mail-ssot/save.js");
const latestHandler = require("../api/mail-ssot/latest.js");

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
});

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

const authState = () => {
  const out = loginWithPassword({
    email: process.env.BLUEPRINT_DEMO_EMAIL || "demo@blueprint.ai",
    password: process.env.BLUEPRINT_DEMO_PASSWORD || "demo123!",
    ip: "127.0.0.1",
    userAgent: "node-test",
  });
  const csrf = "csrf_test_mailssot";
  return {
    token: out.token,
    csrf,
    cookie: `bp_session=${encodeURIComponent(out.token)}; bp_csrf=${encodeURIComponent(csrf)}`,
  };
};

const envelope = () => ({
  schema: "agentc.mailssot.envelope.v1",
  alg: "AES-GCM-256",
  iv: Buffer.from("mailssot-iv", "utf8").toString("base64"),
  ciphertext: Buffer.from("{\"snapshot\":\"encrypted\"}", "utf8").toString("base64"),
  createdAt: new Date().toISOString(),
});

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

test("mail ssot save then latest returns encrypted envelope for mailbox", async () => {
  resetBlueprintDb();
  const auth = authState();

  const authorized = await authorizeConnector({
    connectorId: "mailbox",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      mailboxEmail: "mailssot@blueprint.ai",
      apiKey: "mailbox_live_api_key_123456",
    },
  });

  const saveRes = await callHandler(saveHandler, {
    method: "POST",
    url: "/api/mail-ssot/save",
    headers: {
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "x-forwarded-for": "127.0.0.1",
    },
    body: {
      workspaceId: "ws_core",
      connectionId: authorized.connectionId,
      planId: "plan_ops",
      revision: 3,
      encryptedEnvelope: envelope(),
    },
  });

  assert.equal(saveRes.statusCode, 200);
  const savePayload = JSON.parse(String(saveRes.body || "{}"));
  assert.equal(savePayload.ok, true);
  assert.equal(savePayload.connectorId, "mailbox");
  assert.ok(savePayload.messageId);

  const latestRes = await callHandler(latestHandler, {
    method: "GET",
    url: `/api/mail-ssot/latest?workspaceId=ws_core&connectionId=${encodeURIComponent(
      authorized.connectionId
    )}&planId=plan_ops`,
    query: {
      workspaceId: "ws_core",
      connectionId: authorized.connectionId,
      planId: "plan_ops",
    },
    headers: {
      cookie: auth.cookie,
      "x-forwarded-for": "127.0.0.1",
    },
  });
  assert.equal(latestRes.statusCode, 200);
  const latestPayload = JSON.parse(String(latestRes.body || "{}"));
  assert.equal(latestPayload.ok, true);
  assert.equal(latestPayload.connectorId, "mailbox");
  assert.equal(latestPayload.planId, "plan_ops");
  assert.equal(latestPayload.encryptedEnvelope.schema, "agentc.mailssot.envelope.v1");
});

test("mail ssot save then latest returns encrypted envelope for outlook", async () => {
  resetBlueprintDb();
  const auth = authState();

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/token")) {
      return makeFetchResponse(200, {
        access_token: "access_authorize",
        refresh_token: "refresh_authorize",
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

  const authorized = await authorizeConnector({
    connectorId: "outlook",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      code: "oauth_authorize_code",
    },
  });

  global.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/me/messages")) {
      return makeFetchResponse(201, {
        id: "immutable_message_42",
        createdDateTime: "2026-03-11T09:00:00.000Z",
      });
    }
    if (href.endsWith("/me/messages/immutable_message_42/send")) {
      return makeFetchResponse(202, null);
    }
    if (href.includes("/me/mailFolders/inbox/messages")) {
      return makeFetchResponse(200, {
        value: [],
      });
    }
    if (href.includes("/me/mailFolders/sentitems/messages")) {
      return makeFetchResponse(200, {
        value: [
          {
            id: "immutable_message_42",
            subject: "AGENTC MailSSOT plan_outlook r4",
            body: { contentType: "text", content: encodeEnvelopeBody(envelope()) },
            from: { emailAddress: { address: "bot@blue-print.ai" } },
            toRecipients: [{ emailAddress: { address: "bot@blue-print.ai" } }],
            receivedDateTime: "2026-03-11T09:01:00.000Z",
            createdDateTime: "2026-03-11T09:00:00.000Z",
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const saveRes = await callHandler(saveHandler, {
    method: "POST",
    url: "/api/mail-ssot/save",
    headers: {
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "x-forwarded-for": "127.0.0.1",
    },
    body: {
      workspaceId: "ws_core",
      connectionId: authorized.connectionId,
      planId: "plan_outlook",
      revision: 4,
      encryptedEnvelope: envelope(),
    },
  });

  assert.equal(saveRes.statusCode, 200);
  const savePayload = JSON.parse(String(saveRes.body || "{}"));
  assert.equal(savePayload.ok, true);
  assert.equal(savePayload.connectorId, "outlook");
  assert.equal(savePayload.messageId, "immutable_message_42");

  const latestRes = await callHandler(latestHandler, {
    method: "GET",
    url: `/api/mail-ssot/latest?workspaceId=ws_core&connectionId=${encodeURIComponent(
      authorized.connectionId
    )}&planId=plan_outlook`,
    query: {
      workspaceId: "ws_core",
      connectionId: authorized.connectionId,
      planId: "plan_outlook",
    },
    headers: {
      cookie: auth.cookie,
      "x-forwarded-for": "127.0.0.1",
    },
  });

  assert.equal(latestRes.statusCode, 200);
  const latestPayload = JSON.parse(String(latestRes.body || "{}"));
  assert.equal(latestPayload.ok, true);
  assert.equal(latestPayload.connectorId, "outlook");
  assert.equal(latestPayload.planId, "plan_outlook");
  assert.equal(latestPayload.encryptedEnvelope.schema, "agentc.mailssot.envelope.v1");
});

test("mail ssot save requires csrf token", async () => {
  resetBlueprintDb();
  const auth = authState();
  const authorized = await authorizeConnector({
    connectorId: "mailbox",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      mailboxEmail: "csrf-check@blueprint.ai",
      apiKey: "mailbox_live_api_key_987654",
    },
  });
  const res = await callHandler(saveHandler, {
    method: "POST",
    url: "/api/mail-ssot/save",
    headers: {
      cookie: auth.cookie,
      "x-forwarded-for": "127.0.0.1",
    },
    body: {
      workspaceId: "ws_core",
      connectionId: authorized.connectionId,
      planId: "plan_csrf",
      encryptedEnvelope: envelope(),
    },
  });
  assert.equal(res.statusCode, 403);
  const payload = JSON.parse(String(res.body || "{}"));
  assert.equal(payload.ok, false);
});
