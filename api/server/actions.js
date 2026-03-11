"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { BlueprintError } = require("../../lib/blueprint/errors");
const { prepareServerAction } = require("../../lib/blueprint/services/server_control_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.server.actions" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "ws_core").trim() || "ws_core";
    const actionId = String(body?.actionId || "").trim();
    if (!actionId) {
      throw new BlueprintError(400, "invalid_action", "actionId is required");
    }

    const out = prepareServerAction({
      workspaceId,
      actionId,
      params: body?.params,
      createdBy: String(body?.createdBy || "server-panel").trim() || "server-panel",
    });
    sendJson(res, 201, { ok: true, ...out });
  });
};
