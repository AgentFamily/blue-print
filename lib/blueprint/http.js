"use strict";

const { recordTelemetryEvent } = require("./services/telemetry_service");

const setResponseTelemetryContext = (res, patch = {}) => {
  if (!res || typeof res !== "object") return {};
  const current = res.__blueprintTelemetryContext && typeof res.__blueprintTelemetryContext === "object"
    ? res.__blueprintTelemetryContext
    : {};
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  res.__blueprintTelemetryContext = next;
  return next;
};

const emitResponseTelemetry = (res, bodyType) => {
  if (!res || res.__blueprintTelemetryLogged) return;
  const context = res.__blueprintTelemetryContext;
  if (!context || context.skipResponseTelemetry) return;
  res.__blueprintTelemetryLogged = true;
  try {
    recordTelemetryEvent({
      eventType: "api.request",
      source: context.source || "node_api",
      routeId: context.routeId || "unknown",
      method: context.method || "",
      workspaceId: context.workspaceId || "",
      userId: context.userId || "",
      httpStatus: Number(res.statusCode || 0),
      outcome: context.outcome || (Number(res.statusCode || 0) >= 400 ? "failure" : "success"),
      durationMs:
        typeof context.startedAtMs === "number" && context.startedAtMs > 0
          ? Math.max(0, Date.now() - context.startedAtMs)
          : 0,
      meta: {
        bodyType,
        reason: context.reason || "",
      },
    });
  } catch {
    // Keep telemetry non-blocking for route responses.
  }
};

const sendJson = (res, status, payload, headers = {}) => {
  res.statusCode = Number(status || 200);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers || {})) {
    if (v == null) continue;
    res.setHeader(k, v);
  }
  emitResponseTelemetry(res, "json");
  res.end(JSON.stringify(payload));
};

const sendText = (res, status, text, headers = {}) => {
  res.statusCode = Number(status || 200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers || {})) {
    if (v == null) continue;
    res.setHeader(k, v);
  }
  emitResponseTelemetry(res, "text");
  res.end(String(text || ""));
};

const sendHtml = (res, status, html) => {
  res.statusCode = Number(status || 200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  emitResponseTelemetry(res, "html");
  res.end(String(html || ""));
};

const readJsonBody = async (req) => {
  if (req?.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", resolve);
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const queryValue = (req, name) => {
  if (req?.query && Object.prototype.hasOwnProperty.call(req.query, name)) {
    const raw = req.query[name];
    if (Array.isArray(raw)) return String(raw[0] || "").trim();
    return String(raw || "").trim();
  }
  try {
    const url = new URL(String(req?.url || ""), "http://local");
    return String(url.searchParams.get(name) || "").trim();
  } catch {
    return "";
  }
};

const parseCookies = (req) => {
  const out = {};
  const raw = String(req?.headers?.cookie || "");
  if (!raw) return out;
  for (const chunk of raw.split(";")) {
    const idx = chunk.indexOf("=");
    if (idx === -1) continue;
    const k = chunk.slice(0, idx).trim();
    const v = chunk.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
};

const appendSetCookie = (res, cookieValue) => {
  const value = String(cookieValue || "").trim();
  if (!value) return;
  let current = null;
  try {
    current = res.getHeader("Set-Cookie");
  } catch {
    current = null;
  }
  if (!current) {
    res.setHeader("Set-Cookie", value);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, value]);
    return;
  }
  res.setHeader("Set-Cookie", [current, value]);
};

const isSecureRequest = (req) => {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  if (proto) return proto.includes("https");
  const host = String(req?.headers?.host || "").toLowerCase();
  return host.includes("localhost") ? false : false;
};

const makeCookie = (name, value, { maxAgeSeconds, httpOnly = true, sameSite = "Lax", secure = false, path = "/" } = {}) => {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ""))}`, `Path=${path}`];
  const maxAge = parseInt(String(maxAgeSeconds ?? ""), 10);
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, maxAge)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

const clearCookie = (name, options = {}) =>
  makeCookie(name, "", {
    ...options,
    maxAgeSeconds: 0,
  });

const getClientIp = (req) => {
  const fwd = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (fwd) return fwd.split(",")[0].trim();
  return String(req?.socket?.remoteAddress || "127.0.0.1").trim();
};

const methodIs = (req, method) => String(req?.method || "GET").toUpperCase() === String(method || "").toUpperCase();

module.exports = {
  sendJson,
  sendText,
  sendHtml,
  setResponseTelemetryContext,
  readJsonBody,
  queryValue,
  parseCookies,
  appendSetCookie,
  makeCookie,
  clearCookie,
  isSecureRequest,
  getClientIp,
  methodIs,
};
