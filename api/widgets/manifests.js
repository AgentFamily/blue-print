"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const {
  listWidgetManifests,
  saveWidgetManifest,
  removeWidgetManifest,
} = require("../../lib/blueprint/services/manifest_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, parseCookies, queryValue } = require("../../lib/blueprint/http");
const { ensureCsrf } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.widgets.manifests" }, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    const auth = requireAuthFromRequest(req);

    if (method === "GET") {
      const widgetId = String(queryValue(req, "widgetId") || "").trim();
      const manifests = listWidgetManifests();
      const filtered = widgetId ? manifests.filter((item) => item.widgetId === widgetId) : manifests;
      sendJson(res, 200, { ok: true, manifests: filtered });
      return;
    }

    if (!["POST", "PUT", "DELETE"].includes(method)) {
      methodNotAllowed(res, "GET, POST, PUT, DELETE");
      return;
    }

    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });
    const body = (await readJsonBody(req)) || {};

    if (method === "DELETE") {
      const widgetId = String(body?.widgetId || "").trim();
      if (!widgetId) {
        throw new BlueprintError(400, "invalid_widget_id", "widgetId is required");
      }
      const out = removeWidgetManifest({ actorUserId: auth.user.id, widgetId });
      sendJson(res, 200, out);
      return;
    }

    const manifest = body?.manifest && typeof body.manifest === "object" ? body.manifest : body;
    const saved = saveWidgetManifest({ actorUserId: auth.user.id, manifest });
    sendJson(res, method === "POST" ? 201 : 200, { ok: true, manifest: saved });
  });
};
