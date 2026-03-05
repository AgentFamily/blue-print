"use strict";

const { requireAuthFromRequest } = require("../../lib/blueprint/services/context_service");
const { saveMailSsotSnapshot } = require("../../lib/blueprint/services/mail_ssot_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, readJsonBody, parseCookies, getClientIp } = require("../../lib/blueprint/http");
const { ensureCsrf, checkRateLimit } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const auth = requireAuthFromRequest(req);
    ensureCsrf(req, parseCookies(req), { allowMissingCookie: false });

    const body = (await readJsonBody(req)) || {};
    const workspaceId = String(body?.workspaceId || "").trim();
    if (!workspaceId) {
      throw new BlueprintError(400, "validation", "workspaceId is required");
    }

    const rate = checkRateLimit({
      namespace: "mail_ssot_save",
      key: `${getClientIp(req)}:${workspaceId}`,
      limit: 20,
      windowMs: 60_000,
    });
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      throw new BlueprintError(429, "rate_limited", "Too many MailSSOT save requests");
    }

    const out = await saveMailSsotSnapshot({
      actorUserId: auth.user.id,
      workspaceId,
      connectionId: body?.connectionId,
      planId: body?.planId,
      revision: body?.revision,
      encryptedEnvelope: body?.encryptedEnvelope,
    });

    sendJson(res, 200, out);
  });
};
