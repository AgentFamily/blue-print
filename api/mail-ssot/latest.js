"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const { getLatestMailSsotSnapshot } = require("../../lib/blueprint/services/mail_ssot_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, queryValue, getClientIp } = require("../../lib/blueprint/http");
const { checkRateLimit } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = requireAuthFromRequest(req);
    const workspaceId = String(queryValue(req, "workspaceId") || "").trim();
    const connectionId = String(queryValue(req, "connectionId") || "").trim();
    const planId = String(queryValue(req, "planId") || "").trim();
    if (!workspaceId || !connectionId || !planId) {
      throw new BlueprintError(400, "validation", "workspaceId, connectionId, and planId are required");
    }

    const rate = checkRateLimit({
      namespace: "mail_ssot_latest",
      key: `${getClientIp(req)}:${workspaceId}`,
      limit: 60,
      windowMs: 60_000,
    });
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      throw new BlueprintError(429, "rate_limited", "Too many MailSSOT refresh requests");
    }

    const out = await getLatestMailSsotSnapshot({
      actorUserId: auth.user.id,
      workspaceId,
      connectionId,
      planId,
    });
    sendJson(res, 200, out);
  });
};
