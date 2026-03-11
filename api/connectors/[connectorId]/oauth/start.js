"use strict";

const { requireAuthFromRequest } = require("../../../../lib/blueprint/services/context_service");
const { beginConnectorAuthorization } = require("../../../../lib/blueprint/services/connector_service");
const { handleRoute, methodNotAllowed } = require("../../../../lib/blueprint/route_helpers");
const { sendText, queryValue } = require("../../../../lib/blueprint/http");
const { BlueprintError } = require("../../../../lib/blueprint/errors");

const connectorIdFromReq = (req) => {
  const raw = req?.query?.connectorId;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
};

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.connectors.oauth.start" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const connectorId = connectorIdFromReq(req);
    const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
    if (!connectorId) {
      throw new BlueprintError(400, "invalid_connector", "connectorId is required");
    }
    if (!workspaceId) {
      throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
    }

    const out = await beginConnectorAuthorization({
      connectorId,
      actorUserId: auth.user.id,
      workspaceId,
    });

    res.statusCode = 302;
    res.setHeader("Location", out.redirect);
    sendText(res, 302, `Redirecting to ${out.connectorId} authorization`);
  });
};
