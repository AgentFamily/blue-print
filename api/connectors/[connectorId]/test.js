"use strict";

const { requireAuthFromRequest } = require("../../../lib/blueprint/services/context_service");
const { testConnector, listWorkspaceConnections } = require("../../../lib/blueprint/services/connector_service");
const { handleRoute, methodNotAllowed } = require("../../../lib/blueprint/route_helpers");
const { sendJson, sendHtml, readJsonBody, queryValue, parseCookies, getClientIp } = require("../../../lib/blueprint/http");
const { ensureCsrf, checkRateLimit } = require("../../../lib/blueprint/security");
const { BlueprintError } = require("../../../lib/blueprint/errors");

const connectorIdFromReq = (req) => {
  const raw = req?.query?.connectorId;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
};

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.connectors.test" }, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    const auth = requireAuthFromRequest(req);
    const connectorId = connectorIdFromReq(req);
    if (!connectorId) {
      throw new BlueprintError(400, "invalid_connector", "connectorId is required");
    }

    if (method === "GET") {
      const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
      if (!workspaceId) {
        sendHtml(
          res,
          200,
          "<html><body><h1>Connector Test</h1><p>Provide workspaceId query param and call this endpoint via POST.</p></body></html>"
        );
        return;
      }
      const connections = listWorkspaceConnections({
        actorUserId: auth.user.id,
        workspaceId,
      }).filter((item) => item.connectorId === connectorId);
      sendJson(res, 200, {
        ok: true,
        connectorId,
        workspaceId,
        connections,
        hint: `POST /api/connectors/${connectorId}/test with {workspaceId, connectionId}`,
      });
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    const rate = checkRateLimit({
      namespace: "connector_test",
      key: `${getClientIp(req)}:${connectorId}`,
      limit: 40,
      windowMs: 60_000,
    });
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      throw new BlueprintError(429, "rate_limited", "Too many connector test requests");
    }

    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || queryValue(req, "workspaceId") || "").trim();
    const connectionId = String(body?.connectionId || "").trim();
    if (!workspaceId || !connectionId) {
      throw new BlueprintError(400, "invalid_input", "workspaceId and connectionId are required");
    }

    const result = await testConnector({
      connectorId,
      actorUserId: auth.user.id,
      workspaceId,
      connectionId,
    });

    sendJson(res, 200, {
      ok: true,
      connectorId,
      connectionId,
      result,
    });
  });
};
