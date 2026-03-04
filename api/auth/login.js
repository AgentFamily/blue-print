"use strict";

const { loginWithPassword } = require("../../lib/blueprint/services/auth_service");
const { handleRoute, methodNotAllowed } = require("../../lib/blueprint/route_helpers");
const {
  sendJson,
  readJsonBody,
  parseCookies,
  appendSetCookie,
  makeCookie,
  isSecureRequest,
  getClientIp,
} = require("../../lib/blueprint/http");
const { SESSION_COOKIE, CSRF_COOKIE, randomToken, ensureCsrf, checkRateLimit } = require("../../lib/blueprint/security");
const { BlueprintError } = require("../../lib/blueprint/errors");

module.exports = async (req, res) => {
  await handleRoute(res, async () => {
    const method = String(req?.method || "GET").toUpperCase();
    if (method === "GET") {
      const csrfToken = randomToken(24);
      appendSetCookie(
        res,
        makeCookie(CSRF_COOKIE, csrfToken, {
          maxAgeSeconds: 60 * 60 * 12,
          httpOnly: false,
          secure: isSecureRequest(req),
          sameSite: "Lax",
        })
      );
      sendJson(res, 200, {
        ok: true,
        auth: "login",
        csrfToken,
        hint: "POST email/password with x-csrf-token header set to this token",
      });
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(res, "GET, POST");
      return;
    }

    const rate = checkRateLimit({
      namespace: "auth_login",
      key: getClientIp(req),
      limit: 20,
      windowMs: 60_000,
    });
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      throw new BlueprintError(429, "rate_limited", "Too many login attempts");
    }

    const cookies = parseCookies(req);
    ensureCsrf(req, cookies, { allowMissingCookie: true });

    const body = (await readJsonBody(req)) || {};
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!email || !password) {
      throw new BlueprintError(400, "invalid_input", "email and password are required");
    }

    const out = loginWithPassword({
      email,
      password,
      ip: getClientIp(req),
      userAgent: String(req?.headers?.["user-agent"] || ""),
    });

    const secure = isSecureRequest(req);
    appendSetCookie(
      res,
      makeCookie(SESSION_COOKIE, out.token, {
        maxAgeSeconds: 60 * 60 * 12,
        httpOnly: true,
        secure,
        sameSite: "Lax",
      })
    );

    const csrfToken = randomToken(24);
    appendSetCookie(
      res,
      makeCookie(CSRF_COOKIE, csrfToken, {
        maxAgeSeconds: 60 * 60 * 12,
        httpOnly: false,
        secure,
        sameSite: "Lax",
      })
    );

    sendJson(res, 200, {
      ok: true,
      expiresAt: out.expiresAt,
      csrfToken,
      ...out.me,
    });
  });
};
