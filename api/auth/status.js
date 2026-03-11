"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue } = require("../../lib/blueprint/http");
const { readApprovalRequest } = require("../../lib/blueprint/services/auth_request_service");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.auth.status" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const code = String(queryValue(req, "code") || "").trim();
    if (!code) {
      throw new BlueprintError(400, "invalid_code", "code is required");
    }
    const auth = readApprovalRequest(code);
    sendJson(res, 200, { ok: true, auth });
  });
};
