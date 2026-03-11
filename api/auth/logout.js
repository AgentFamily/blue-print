"use strict";

const { logoutSession } = require("../../lib/blueprint/services/auth_service");
const { authFromRequest } = require("../../lib/blueprint/services/context_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, parseCookies, appendSetCookie, clearCookie, isSecureRequest } = require("../../lib/blueprint/http");
const { SESSION_COOKIE, CSRF_COOKIE, ensureCsrf } = require("../../lib/blueprint/security");

module.exports = async (req, res) => {
  await handleRoute(res, { routeId: "api.auth.logout" }, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "POST") {
      methodNotAllowed(res, "POST");
      return;
    }

    const cookies = parseCookies(req);
    ensureCsrf(req, cookies, { allowMissingCookie: false });

    const auth = authFromRequest(req);
    if (auth?.token) {
      logoutSession({ actorUserId: auth.user.id, token: auth.token });
    }

    const secure = isSecureRequest(req);
    appendSetCookie(res, clearCookie(SESSION_COOKIE, { secure, sameSite: "Lax", httpOnly: true }));
    appendSetCookie(res, clearCookie(CSRF_COOKIE, { secure, sameSite: "Lax", httpOnly: false }));

    sendJson(res, 200, { ok: true });
  });
};
