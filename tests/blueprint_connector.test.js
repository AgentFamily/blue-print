process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const {
  authorizeConnector,
  testConnector,
  getConnectorRequirements,
} = require("../lib/blueprint/services/connector_service");

test("fasthosts connector requirements shape is available", () => {
  const reqs = getConnectorRequirements({ connectorId: "fasthosts" });
  assert.equal(reqs.id, "fasthosts");
  assert.equal(reqs.authType, "apiKey");
  assert.ok(Array.isArray(reqs.fields));
  assert.ok(reqs.fields.some((field) => field.name === "apiKey"));
});

test("outlook connector requirements expose oauth2 without credential fields", () => {
  const reqs = getConnectorRequirements({ connectorId: "outlook" });
  assert.equal(reqs.id, "outlook");
  assert.equal(reqs.authType, "oauth2");
  assert.equal(reqs.oauthStartSupported, true);
  assert.deepEqual(reqs.fields, []);
});

test("fasthosts authorize + test succeeds for valid-looking key", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "fh_live_valid_mock_key_123456",
      scopes: ["domain:read", "dns:read"],
    },
  });

  assert.ok(authorized.connectionId);

  const result = await testConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
});

test("fasthosts test returns not-ok for invalid key format", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "short",
      scopes: ["domain:read"],
    },
  });

  const result = await testConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, false);
});

test("openai connector authorize + test succeeds", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "openai",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "sk-test-openai-key-1234567890",
      organization: "org_blueprint",
      scopes: ["responses:write", "models:read"],
    },
  });

  const result = await testConnector({
    connectorId: "openai",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
});
