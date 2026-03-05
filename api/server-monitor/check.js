"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  resolveWorkspaceId,
  ensureWorkspaceAdmin,
  getMonitorContext,
  buildStatePayload,
  runMonitorCheck,
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

    const context = await getMonitorContext({
      actorUserId: auth.user.id,
      workspaceId,
      probeReady: false,
    });

    if (context.gate.state === "vault_locked" || context.gate.state === "credentials_missing") {
      sendJson(res, 409, {
        ...buildStatePayload(context),
        ok: false,
        error: context.gate.state,
        message: context.gate.message,
      });
      return;
    }

    const report = await runMonitorCheck(context);
    const runtimeGate = report.ok
      ? {
          state: "ready",
          level: "healthy",
          message: "Monitor check completed.",
          missing: [],
          canRunCheck: true,
        }
      : {
          state: "monitoring_not_configured",
          level: "warning",
          message: "Install Monitor Agent or verify monitor endpoint connectivity.",
          missing: ["monitor_agent_install"],
          canRunCheck: false,
        };

    sendJson(res, 200, {
      ok: true,
      workspaceId,
      gate: runtimeGate,
      report,
    });
  });
};
