"use strict";

const { requireAuthFromRequest } = require("../../../lib/blueprint/services/context_service");
const { getConnectorRequirements } = require("../../../lib/blueprint/services/connector_service");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../../lib/blueprint/http");
const { BlueprintError } = require("../../../lib/blueprint/errors");

const connectorIdFromReq = (req) => {
  const raw = req?.query?.connectorId;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
};

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    requireAuthFromRequest(req);
    const connectorId = connectorIdFromReq(req);
    if (!connectorId) {
      throw new BlueprintError(400, "invalid_connector", "connectorId is required");
    }

    const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
    const requirements = getConnectorRequirements({ connectorId, workspaceId });
    sendJson(res, 200, { ok: true, connector: requirements });
  });
};
