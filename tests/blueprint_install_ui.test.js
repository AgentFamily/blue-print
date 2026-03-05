process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { loginWithPassword } = require("../lib/blueprint/services/auth_service");
const connectorsHandler = require("../api/connectors/index.js");
const authorizeHandler = require("../api/connectors/[connectorId]/authorize.js");

const EXPECTED_CONNECTOR_IDS = [
  "mailbox",
  "fasthosts",
  "namecheap",
  "autotrader",
  "myclickdealer",
  "booking",
  "skyscanner",
  "openai",
  "meta_ads",
  "zillow",
  "rightmove",
];

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

const authCookie = () => {
  const out = loginWithPassword({
    email: process.env.BLUEPRINT_DEMO_EMAIL || "demo@blueprint.ai",
    password: process.env.BLUEPRINT_DEMO_PASSWORD || "demo123!",
    ip: "127.0.0.1",
    userAgent: "node-test",
  });
  return `bp_session=${encodeURIComponent(out.token)}`;
};

test("install center renders clear install button for all strategic connectors", async () => {
  resetBlueprintDb();
  const cookie = authCookie();

  const res = await callHandler(connectorsHandler, {
    method: "GET",
    url: "/api/connectors?workspaceId=ws_core&view=install",
    query: { workspaceId: "ws_core", view: "install" },
    headers: { cookie },
  });

  assert.equal(res.statusCode, 200);
  const html = String(res.body || "");
  assert.equal(html.includes("Connector Install Center"), true);
  for (const connectorId of EXPECTED_CONNECTOR_IDS) {
    assert.equal(html.includes(`data-header-install="${connectorId}"`), true);
  }
  const installCount = (html.match(/Install /g) || []).length;
  assert.equal(installCount >= EXPECTED_CONNECTOR_IDS.length, true);
  assert.equal(html.includes("/api/connectors/fasthosts/authorize"), true);
  assert.equal(html.includes("/api/connectors/rightmove/authorize"), true);
});

test("connector authorize page includes explicit Install Connector button", async () => {
  resetBlueprintDb();
  const cookie = authCookie();

  const res = await callHandler(authorizeHandler, {
    method: "GET",
    url: "/api/connectors/namecheap/authorize?workspaceId=ws_core",
    query: { connectorId: "namecheap", workspaceId: "ws_core" },
    headers: { cookie },
  });

  assert.equal(res.statusCode, 200);
  const html = String(res.body || "");
  assert.equal(html.includes("Header Install APIs"), true);
  for (const connectorId of EXPECTED_CONNECTOR_IDS) {
    assert.equal(html.includes(`data-header-install="${connectorId}"`), true);
  }
  assert.equal(html.includes("Install Connector"), true);
  assert.equal(html.includes("Authorize Namecheap"), true);
});
