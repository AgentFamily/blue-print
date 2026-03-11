process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { listVaultRecords, resetBlueprintDb } = require("../lib/blueprint/db");
const {
  getServerPanel,
  prepareServerAction,
} = require("../lib/blueprint/services/server_control_service");

test("server panel defaults to locked safe mode", () => {
  resetBlueprintDb();
  const panel = getServerPanel({ workspaceId: "ws_core" });
  assert.equal(panel.safeMode.mode, "LOCKED");
  assert.equal(panel.safeMode.rootLogin, "OFF");
  assert.equal(panel.safeMode.passwordLogin, "OFF");
  assert.equal(panel.safeMode.sshKeyOnly, "ON");
  assert.equal(panel.safeMode.firewall, "ON");
  assert.equal(panel.safeMode.humanApproval, "REQUIRED");
});

test("server action planning prepares approval-gated pending external plans", () => {
  resetBlueprintDb();
  const out = prepareServerAction({
    workspaceId: "ws_core",
    actionId: "open_access_5m",
    createdBy: "system",
  });
  assert.equal(out.plan.actionId, "open_access_5m");
  assert.equal(out.plan.status, "pending_external");
  assert.equal(out.panel.indicator, "amber");
});

test("xitoring install plan keeps the key in vault metadata instead of the command body", () => {
  resetBlueprintDb();
  const out = prepareServerAction({
    workspaceId: "ws_core",
    actionId: "install_xitoring_agent",
    params: {
      secretRefId: "sec_xitoring_install",
      notification: "default",
    },
    createdBy: "system",
  });

  assert.equal(out.plan.actionId, "install_xitoring_agent");
  assert.equal(out.plan.status, "pending_external");

  const records = listVaultRecords({
    workspaceId: "ws_core",
    recordType: "server_action",
    limit: 10,
  });
  assert.equal(records.length, 1);
  assert.equal(String(records[0].payload.keySource.secretRefId || "").includes("[masked:"), true);
  assert.equal(String(records[0].payload.commandTemplate).includes("app.xitoring.com"), true);
  assert.equal(String(records[0].payload.commandTemplate).includes("3712405c0f11df66796e3d4ad3b53f21"), false);
  assert.equal(Array.isArray(records[0].payload.missingRequirements), true);
  assert.equal(records[0].payload.missingRequirements.length, 0);
});
