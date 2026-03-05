process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const { loginWithPassword } = require("../lib/blueprint/services/auth_service");
const { lockVault } = require("../lib/vault_broker");

const stateHandler = require("../api/server-monitor/state.js");
const configHandler = require("../api/server-monitor/config.js");
const checkHandler = require("../api/server-monitor/check.js");

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
    email: process.env.BLUEPRINT_ADMIN_EMAIL || "admin@blueprint.ai",
    password: process.env.BLUEPRINT_ADMIN_PASSWORD || "admin123!",
    ip: "127.0.0.1",
    userAgent: "node-test",
  });
  return `bp_session=${encodeURIComponent(out.token)}`;
};

test("server monitor state returns vault_locked gate initially", async () => {
  resetBlueprintDb();
  await lockVault({
    actorType: "system",
    actorId: "test-lock",
    reason: "test_setup",
    botId: "test-suite",
  });

  const cookie = authCookie();
  const res = await callHandler(stateHandler, {
    method: "GET",
    url: "/api/server-monitor/state?workspaceId=ws_core",
    query: { workspaceId: "ws_core" },
    headers: { cookie },
  });

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(String(res.body || "{}"));
  assert.equal(payload.ok, true);
  assert.equal(payload.gate.state, "vault_locked");
});

test("server monitor config unlocks vault and stores credentials", async () => {
  resetBlueprintDb();
  await lockVault({
    actorType: "system",
    actorId: "test-lock",
    reason: "test_setup",
    botId: "test-suite",
  });

  const cookie = authCookie();

  const unlockRes = await callHandler(configHandler, {
    method: "POST",
    url: "/api/server-monitor/config",
    headers: { cookie },
    body: {
      workspaceId: "ws_core",
      action: "unlock_vault",
    },
  });
  assert.equal(unlockRes.statusCode, 200);

  const saveRes = await callHandler(configHandler, {
    method: "POST",
    url: "/api/server-monitor/config",
    headers: { cookie },
    body: {
      workspaceId: "ws_core",
      config: {
        monitorAgentUrl: "http://127.0.0.1:9870/health",
        primaryDomains: ["example.com"],
      },
      monitorAgentToken: "test-token",
    },
  });

  assert.equal(saveRes.statusCode, 200);
  const payload = JSON.parse(String(saveRes.body || "{}"));
  assert.equal(payload.ok, true);
  assert.equal(payload.config.hasAgentToken, true);
  assert.equal(payload.config.monitorAgentUrl.includes("127.0.0.1"), true);
  assert.equal(Array.isArray(payload.config.primaryDomains), true);
});

test("server monitor check returns health signals and alert rules", async () => {
  resetBlueprintDb();
  await lockVault({
    actorType: "system",
    actorId: "test-lock",
    reason: "test_setup",
    botId: "test-suite",
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      generatedAt: new Date().toISOString(),
      host: {
        hostname: "vps-test",
        os: "Ubuntu 24.04",
        controlPanel: "Plesk/WebPros",
      },
      signals: {
        cpu: { percent: 91, avg5mPercent: 92 },
        ram: { percent: 88, avg5mPercent: 91 },
        disk: { usedPercent: 88.4, freeGb: 12.5, totalGb: 100 },
        uptime: { seconds: 7200, lastRebootAt: new Date(Date.now() - 7200000).toISOString() },
      },
      maintenance: {
        pendingOsUpdates: 4,
        pleskUpdatesAvailable: true,
        ssl: [
          {
            domain: "example.com",
            status: "expiring",
            daysRemaining: 12,
            expiresAt: new Date(Date.now() + 12 * 86400000).toISOString(),
          },
        ],
      },
    }),
  });

  try {
    const cookie = authCookie();

    await callHandler(configHandler, {
      method: "POST",
      url: "/api/server-monitor/config",
      headers: { cookie },
      body: {
        workspaceId: "ws_core",
        action: "unlock_vault",
      },
    });

    await callHandler(configHandler, {
      method: "POST",
      url: "/api/server-monitor/config",
      headers: { cookie },
      body: {
        workspaceId: "ws_core",
        config: {
          monitorAgentUrl: "http://127.0.0.1:9870/health",
          primaryDomains: ["example.com"],
        },
        monitorAgentToken: "test-token",
      },
    });

    const checkRes = await callHandler(checkHandler, {
      method: "POST",
      url: "/api/server-monitor/check",
      headers: { cookie },
      body: { workspaceId: "ws_core" },
    });

    assert.equal(checkRes.statusCode, 200);
    const payload = JSON.parse(String(checkRes.body || "{}"));
    assert.equal(payload.ok, true);
    assert.equal(payload.report.ok, true);
    assert.equal(payload.report.status, "warning");
    assert.equal(payload.report.alerts.some((row) => row.id === "disk_warning"), true);
    assert.equal(payload.report.alerts.some((row) => row.id === "cpu_warning"), true);
    assert.equal(payload.report.alerts.some((row) => row.id === "ram_warning"), true);
    assert.equal(payload.report.maintenance.pendingOsUpdates, 4);
  } finally {
    global.fetch = originalFetch;
  }
});
