process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const recordsHandler = require("../api/vault/records.js");
const recordHandler = require("../api/vault/records/[recordId].js");
const { callHandler, authSessionCookie } = require("./test_utils");

test("vault records API stores typed records and masks secret-like payload fields", async () => {
  resetBlueprintDb();
  const cookie = authSessionCookie();
  const csrf = "csrf-test-token";

  const created = await callHandler(recordsHandler, {
    method: "POST",
    headers: {
      cookie: `${cookie}; bp_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
    body: {
      workspaceId: "ws_core",
      recordType: "log",
      title: "API call",
      payload: {
        apiKey: "sk-live-test-secret",
        route: "/api/chat",
      },
    },
  });
  assert.equal(created.statusCode, 201);
  const createdJson = JSON.parse(created.body);
  assert.equal(createdJson.record.recordType, "log");
  assert.equal(String(createdJson.record.payload.apiKey || "").includes("[masked:"), true);

  const fetched = await callHandler(recordHandler, {
    method: "GET",
    url: `/api/vault/records/${encodeURIComponent(createdJson.record.recordId)}?workspaceId=ws_core`,
    query: {
      recordId: createdJson.record.recordId,
      workspaceId: "ws_core",
    },
    headers: { cookie },
  });
  assert.equal(fetched.statusCode, 200);
  const fetchedJson = JSON.parse(fetched.body);
  assert.equal(fetchedJson.record.recordId, createdJson.record.recordId);
});
