"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { applyApprovalDecision } = require("../../lib/blueprint/services/auth_request_service");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.auth.webhook" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const body = (await readJsonBody(req)) || {};
    const code = String(body?.code || "").trim();
    const decision = String(body?.decision || "").trim();
    if (!code || !decision) {
      throw new BlueprintError(400, "invalid_input", "code and decision are required");
    }

    const auth = applyApprovalDecision({
      code,
      decision,
      verified: body?.verified !== false,
      reviewerNotes: body?.reviewerNotes,
      sessionSnapshot: body?.sessionSnapshot,
      createdBy: String(body?.createdBy || "webhook").trim() || "webhook",
    });

    sendJson(res, 200, { ok: true, auth });
  });
};
