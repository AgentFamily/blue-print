process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { listConnectors } = require("../lib/blueprint/connectors/registry");
const { listConnectorCatalog } = require("../lib/blueprint/services/connector_service");
const { listWidgetManifests } = require("../lib/blueprint/services/manifest_service");

const EXPECTED_CONNECTORS = [
  "fasthosts",
  "mailbox",
  "outlook",
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

const EXPECTED_WIDGETS = [
  "widget_domain_valuator",
  "widget_car_valuator",
  "widget_trip_finder",
  "widget_ad_generator",
  "widget_property_evaluator",
];

test("connector registry includes all strategic APIs", () => {
  const connectorIds = new Set(listConnectors().map((item) => item.id));
  for (const id of EXPECTED_CONNECTORS) {
    assert.equal(connectorIds.has(id), true, `missing connector: ${id}`);
  }
});

test("connector catalog exposes clear install action for every connector", () => {
  resetBlueprintDb();
  const catalog = listConnectorCatalog({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
  });

  for (const id of EXPECTED_CONNECTORS) {
    const item = catalog.find((row) => row.id === id);
    assert.ok(item, `connector not listed: ${id}`);
    assert.equal(item.actions.installConnectorLabel, "Install Connector");
    assert.ok(item.actions.installConnectorUrl.includes(`/api/connectors/${id}/authorize`));
  }
});

test("strategic widget manifests are seeded and mapped to required connectors", () => {
  resetBlueprintDb();
  const manifests = listWidgetManifests();

  for (const widgetId of EXPECTED_WIDGETS) {
    const manifest = manifests.find((row) => row.widgetId === widgetId);
    assert.ok(manifest, `missing strategic manifest: ${widgetId}`);
    assert.equal(Array.isArray(manifest.requiredConnectors), true);
    assert.equal(manifest.requiredConnectors.length >= 2, true);
  }
});
