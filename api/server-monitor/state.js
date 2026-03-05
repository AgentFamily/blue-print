"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../lib/blueprint/http");
const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  resolveWorkspaceId,
  ensureWorkspaceAdmin,
  getMonitorContext,
  buildStatePayload,
} = require("../../lib/server_monitor");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    if (method !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const workspaceId = resolveWorkspaceId(auth, queryValue(req, "workspaceId"));
    ensureWorkspaceAdmin(auth, workspaceId);

    const context = await getMonitorContext({
      actorUserId: auth.user.id,
      workspaceId,
      probeReady: true,
    });

    sendJson(res, 200, buildStatePayload(context));
  });
};
