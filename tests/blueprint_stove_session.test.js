process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { authorizeConnector } = require("../lib/blueprint/services/connector_service");
const { compileWorkspaceSession } = require("../lib/blueprint/services/widget_rendering_stove_service");
const stoveSessionHandler = require("../api/stove/session.js");
const { callHandler, authSessionCookie } = require("./test_utils");

test("stove compiler blocks domain workspace when required connectors are missing", () => {
  resetBlueprintDb();

  const out = compileWorkspaceSession({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    taskType: "domain valuation",
    taskGoal: "Value example.com and compare registrar data before pricing the domain.",
    availableApis: ["fasthosts", "namecheap"],
  });

  assert.equal(out.ok, true);
  assert.equal(out.manifest.sessionMode, "blocked");
  assert.equal(out.manifest.widgets.some((item) => item.widgetId === "widget_domain_valuator"), false);
  assert.equal(
    out.manifest.rejectedWidgets.some((item) => item.widgetId === "widget_domain_valuator" && item.status === "missing_dependency"),
    true
  );
});

test("stove compiler emits a renderable valuation session after connector authorization", async () => {
  resetBlueprintDb();

  await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "fh_live_valid_mock_key_200001",
      scopes: ["domain:read", "dns:read"],
    },
  });

  await authorizeConnector({
    connectorId: "namecheap",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiUser: "agentc-namecheap",
      apiKey: "nc_live_mock_key_200001",
      scopes: ["domain:read", "pricing:read"],
    },
  });

  const out = compileWorkspaceSession({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    taskType: "domain valuation",
    taskGoal: "Value example.com and compare registrar data before pricing the domain.",
    availableApis: ["fasthosts", "namecheap"],
  });

  assert.equal(out.ok, true);
  assert.equal(out.manifest.sessionMode, "compose");
  const domainWidget = out.manifest.widgets.find((item) => item.widgetId === "widget_domain_valuator");
  assert.ok(domainWidget);
  assert.equal(domainWidget.widgetType, "valuation_tool");
  assert.equal(Array.isArray(domainWidget.dataDependencies), true);
  assert.equal(domainWidget.dataDependencies.length, 2);
  assert.equal(domainWidget.position.x >= 0, true);
});

test("stove compiler adds coordination and reviewer widgets for multi-agent sessions", () => {
  resetBlueprintDb();

  const out = compileWorkspaceSession({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    taskType: "multi agent review",
    taskGoal: "Compare two agent lanes and choose the winning execution plan.",
    agents: [
      { id: "lane_a", role: "planner", title: "Planner" },
      { id: "lane_b", role: "reviewer", title: "Reviewer" },
    ],
  });

  assert.equal(out.ok, true);
  assert.equal(out.manifest.sessionMode, "multi_agent");
  assert.equal(out.manifest.widgets.some((item) => item.widgetId === "auto_shoot_evaluator"), true);
  assert.equal(out.manifest.widgets.some((item) => item.widgetId === "reviewer_agent"), true);
});

test("stove session api returns an authenticated manifest", async () => {
  resetBlueprintDb();
  const csrfToken = "stove-csrf-token";

  const res = await callHandler(stoveSessionHandler, {
    method: "POST",
    headers: {
      cookie: `${authSessionCookie()}; bp_csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
    },
    body: {
      workspaceId: "ws_core",
      taskType: "server access review",
      taskGoal: "Review a firewall change and guard execution before any server action runs.",
      availableApis: [],
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(typeof json.manifest.sessionId, "string");
  assert.equal(json.manifest.widgets.some((item) => item.widgetId === "server_control"), true);
  assert.equal(json.manifest.widgets.some((item) => item.widgetId === "reviewer_agent"), true);
});
