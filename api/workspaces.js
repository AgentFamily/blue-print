"use strict";

const { requireAuthFromRequest } = require("../lib/blueprint/services/context_service");
const { listAccessibleWorkspaces } = require("../lib/blueprint/services/workspace_service");
const { handleRoute, methodNotAllowed } = require("../lib/blueprint/route_helpers");
const { sendJson } = require("../lib/blueprint/http");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const workspaces = listAccessibleWorkspaces(auth.user.id);
    sendJson(res, 200, { ok: true, workspaces });
  });
};
