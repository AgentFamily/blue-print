process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const requestHandler = require("../api/auth/request.js");
const statusHandler = require("../api/auth/status.js");
const webhookHandler = require("../api/auth/webhook.js");
const { callHandler } = require("./test_utils");

test("auth request flow creates, reads, and approves a handoff request", async () => {
  resetBlueprintDb();

  const created = await callHandler(requestHandler, {
    method: "POST",
    body: {
      workspaceId: "ws_core",
      task: "Complete captcha in browser session",
      requester: "user@example.com",
      receiver: "bot@blue-print.ai",
      channel: "email",
      kind: "captcha",
      sessionSnapshot: { browserUrl: "https://example.com/login" },
    },
    headers: {},
  });
  assert.equal(created.statusCode, 201);
  const createdJson = JSON.parse(created.body);
  assert.equal(createdJson.ok, true);
  assert.equal(createdJson.auth.kind, "captcha");
  assert.equal(createdJson.auth.status, "pending");

  const pending = await callHandler(statusHandler, {
    method: "GET",
    url: `/api/auth/status?code=${encodeURIComponent(createdJson.auth.code)}`,
    query: { code: createdJson.auth.code },
    headers: {},
  });
  assert.equal(pending.statusCode, 200);
  const pendingJson = JSON.parse(pending.body);
  assert.equal(pendingJson.auth.code, createdJson.auth.code);

  const approved = await callHandler(webhookHandler, {
    method: "POST",
    body: {
      code: createdJson.auth.code,
      decision: "YES",
      verified: true,
    },
    headers: {},
  });
  assert.equal(approved.statusCode, 200);
  const approvedJson = JSON.parse(approved.body);
  assert.equal(approvedJson.auth.status, "approved");
  assert.equal(approvedJson.auth.decision, "approved");
});
