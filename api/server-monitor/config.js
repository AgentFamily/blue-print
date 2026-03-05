"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  resolveWorkspaceId,
  ensureWorkspaceAdmin,
  saveMonitorConfig,
  getMonitorContext,
  buildStatePayload,
  unlockMonitorVault,
} = require("../../lib/server_monitor");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    if (method !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const body = (await readJsonBody(req)) || {};
    const workspaceId = resolveWorkspaceId(auth, body.workspaceId);
    ensureWorkspaceAdmin(auth, workspaceId);

    const action = String(body.action || "save").trim().toLowerCase();
    if (action === "unlock_vault" || action === "unlock") {
      await unlockMonitorVault({
        actorId: auth.user.id,
        botId: "server-monitor-widget",
      });
      const unlockedContext = await getMonitorContext({
        actorUserId: auth.user.id,
        workspaceId,
        probeReady: false,
      });
      sendJson(res, 200, buildStatePayload(unlockedContext));
      return;
    }

    const current = await getMonitorContext({
      actorUserId: auth.user.id,
      workspaceId,
      probeReady: false,
    });

    if (!current.vaultState?.unlocked) {
      sendJson(res, 423, {
        ...buildStatePayload(current),
        ok: false,
        error: "vault_locked",
        message: "Unlock Vault to save monitor credentials.",
      });
      return;
    }

    const patch = body.config && typeof body.config === "object" ? body.config : {};
    const token = typeof body.monitorAgentToken === "string" ? body.monitorAgentToken : "";

    await saveMonitorConfig({
      actorUserId: auth.user.id,
      workspaceId,
      patch,
      token,
    });

    const next = await getMonitorContext({
      actorUserId: auth.user.id,
      workspaceId,
      probeReady: true,
    });

    sendJson(res, 200, buildStatePayload(next));
  });
};
