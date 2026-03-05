process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { loginWithPassword } = require("../lib/blueprint/services/auth_service");
const { authorizeConnector } = require("../lib/blueprint/services/connector_service");
const saveHandler = require("../api/mail-ssot/save.js");
const latestHandler = require("../api/mail-ssot/latest.js");

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

test("mail ssot save then latest returns encrypted envelope", async () => {
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
  assert.equal(latestPayload.planId, "plan_ops");
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
