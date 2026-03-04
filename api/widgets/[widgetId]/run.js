"use strict";

const { requireAuthFromRequest } = require("../../../lib/blueprint/services/context_service");
const { runWidget } = require("../../../lib/blueprint/services/widget_runner_service");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, parseCookies, queryValue } = require("../../../lib/blueprint/http");
const { ensureCsrf } = require("../../../lib/blueprint/security");
const { BlueprintError } = require("../../../lib/blueprint/errors");

const widgetIdFromReq = (req) => {
  const raw = req?.query?.widgetId;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
};

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const auth = requireAuthFromRequest(req);
    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });

    const widgetId = widgetIdFromReq(req);
    if (!widgetId) {
      throw new BlueprintError(400, "invalid_widget_id", "widgetId is required");
    }

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || queryValue(req, "workspaceId") || "").trim();
    if (!workspaceId) {
      throw new BlueprintError(400, "invalid_workspace", "workspaceId is required");
    }

    const result = await runWidget({
      actorUserId: auth.user.id,
      workspaceId,
      widgetId,
      input: body?.input,
    });

    if (!result.ok && result.error === "authorization_required") {
      sendJson(res, 412, result);
      return;
    }

    sendJson(res, 200, result);
  });
};
