"use strict";

const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody } = require("../../lib/blueprint/http");
const { assessExecutionRequest } = require("../../lib/blueprint/services/reviewer_service");
const { createApprovalRequest } = require("../../lib/blueprint/services/auth_request_service");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.auth.request" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "ws_core").trim() || "ws_core";
    const task = String(body?.task || "").trim();
    const reviewer = assessExecutionRequest({
      workspaceId,
      prompt: task,
      taskContext: {
        actionArea: "auth_request",
        kind: body?.kind,
        sessionSnapshot: body?.sessionSnapshot || {},
      },
      intents: ["browser_handoff"],
    });

    const auth = createApprovalRequest({
      workspaceId,
      task,
      requester: body?.requester,
      receiver: body?.receiver,
      channel: body?.channel,
      kind: body?.kind,
      sessionSnapshot: body?.sessionSnapshot,
      reviewer,
      createdBy: String(body?.createdBy || "system").trim() || "system",
      code: body?.code,
    });

    sendJson(res, 201, { ok: true, auth });
  });
};
