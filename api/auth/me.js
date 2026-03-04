"use strict";

const { authFromRequest } = require("../../lib/blueprint/services/context_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const { sendJson, parseCookies, appendSetCookie, makeCookie, isSecureRequest } = require("../../lib/blueprint/http");
const { CSRF_COOKIE, randomToken } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    if (String(req?.method || "GET").toUpperCase() !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }

    const auth = authFromRequest(req);
    if (!auth) {
      throw new BlueprintError(401, "unauthorized", "Authentication required");
    }

    const cookies = parseCookies(req);
    let csrfToken = String(cookies?.[CSRF_COOKIE] || "");
    if (!csrfToken) {
      csrfToken = randomToken(24);
      appendSetCookie(
        res,
        makeCookie(CSRF_COOKIE, csrfToken, {
          maxAgeSeconds: 60 * 60 * 12,
          httpOnly: false,
          secure: isSecureRequest(req),
          sameSite: "Lax",
        })
      );
    }

    sendJson(res, 200, {
      ok: true,
      csrfToken,
      ...auth.me,
    });
  });
};
