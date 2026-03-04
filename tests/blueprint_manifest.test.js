process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const {
  validateManifest,
  saveWidgetManifest,
} = require("../lib/blueprint/services/manifest_service");
const { authorizeConnector } = require("../lib/blueprint/services/connector_service");
const { runWidget } = require("../lib/blueprint/services/widget_runner_service");

const validManifest = {
  widgetId: "widget_domain_health",
  name: "Domain Health Widget",
  version: "1.0.0",
  requiredConnectors: [
    {
      connectorId: "fasthosts",
      scopes: ["domain:read"],
      fields: ["apiKey"],
    },
  ],
  runPolicy: { serverOnly: true },
  ui: { category: "Finding" },
};

test("manifest validation accepts valid schema", () => {
  const parsed = validateManifest(validManifest);
  assert.equal(parsed.widgetId, "widget_domain_health");
  assert.equal(parsed.runPolicy.serverOnly, true);
});

test("manifest validation rejects invalid schema", () => {
  assert.throws(
    () =>
      validateManifest({
        widgetId: "bad",
        name: "Bad",
        version: "1",
        requiredConnectors: [],
        runPolicy: { serverOnly: false },
        ui: { category: "Finding" },
      }),
    /runPolicy\.serverOnly must be true|Manifest validation failed/
  );
});

test("widget run returns authorization plan when connector is missing then runs after authorization", async () => {
  resetBlueprintDb();
  saveWidgetManifest({ actorUserId: "usr_admin", manifest: validManifest });

  const missing = await runWidget({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    widgetId: validManifest.widgetId,
    input: { targetDomain: "example.com" },
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.error, "authorization_required");
  assert.ok(Array.isArray(missing.authorizationPlan.missing));
  assert.equal(missing.authorizationPlan.missing.length, 1);

  await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "fh_live_valid_mock_key_654321",
      scopes: ["domain:read", "dns:read"],
    },
  });

  const success = await runWidget({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    widgetId: validManifest.widgetId,
    input: { targetDomain: "example.com" },
  });

  assert.equal(success.ok, true);
  assert.equal(success.widgetId, validManifest.widgetId);
  assert.equal(Array.isArray(success.connectorResults), true);
  assert.equal(success.connectorResults.length, 1);
});

test("strategic Domain Valuator requires both Fasthosts and Namecheap", async () => {
  resetBlueprintDb();

  const initial = await runWidget({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    widgetId: "widget_domain_valuator",
    input: { domain: "example.com" },
  });
  assert.equal(initial.ok, false);
  assert.equal(initial.error, "authorization_required");
  assert.equal(initial.authorizationPlan.missing.length >= 2, true);

  await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "fh_live_valid_mock_key_100001",
      scopes: ["domain:read", "dns:read"],
    },
  });

  const mid = await runWidget({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    widgetId: "widget_domain_valuator",
    input: { domain: "example.com" },
  });
  assert.equal(mid.ok, false);
  assert.equal(mid.error, "authorization_required");
  assert.equal(mid.authorizationPlan.missing.some((row) => row.connectorId === "namecheap"), true);

  await authorizeConnector({
    connectorId: "namecheap",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiUser: "agentc-namecheap",
      apiKey: "nc_live_mock_key_100001",
      scopes: ["domain:read", "pricing:read"],
    },
  });

  const success = await runWidget({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    widgetId: "widget_domain_valuator",
    input: { domain: "example.com" },
  });
  assert.equal(success.ok, true);
  assert.equal(success.connectorResults.length, 2);
});
