"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const { compileWorkspaceSession } = require("../../lib/blueprint/services/widget_rendering_stove_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, parseCookies } = require("../../lib/blueprint/http");
const { ensureCsrf } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.stove.session" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const auth = requireAuthFromRequest(req);
    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "").trim();
    if (!workspaceId) {
      throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
    }

    const result = compileWorkspaceSession({
      actorUserId: auth.user.id,
      workspaceId,
      taskType: body?.taskType,
      taskGoal: body?.taskGoal,
      agentRole: body?.agentRole,
      sessionPermissions: body?.sessionPermissions,
      availableApis: body?.availableApis,
      currentDesktopState: body?.currentDesktopState,
      currentSessionState: body?.currentSessionState,
      savedWorkspaceTemplates: body?.savedWorkspaceTemplates,
      templateId: body?.templateId,
      allowAutomation: body?.allowAutomation,
      agents: body?.agents,
    });

    sendJson(res, 200, result);
  });
};
