"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../lib/blueprint/http");
const { getServerPanel } = require("../../lib/blueprint/services/server_control_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.server.panel" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const workspaceId = String(queryValue(req, "workspaceId") || "ws_core").trim() || "ws_core";
    const panel = getServerPanel({ workspaceId });
    sendJson(res, 200, { ok: true, panel });
  });
};
