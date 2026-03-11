"use strict";

const { sendJson, sendText, setResponseTelemetryContext } = require("./http");
const { toErrorPayload, BlueprintError } = require("./errors");

const methodNotAllowed = (res, allow) => {
  res.statusCode = 405;
  res.setHeader("Allow", allow);
  setResponseTelemetryContext(res, {
    outcome: "failure",
    reason: "method_not_allowed",
  });
  sendText(res, 405, "Method Not Allowed");
};

const resolveHandleRouteArgs = (contextOrFn, maybeFn) => {
  if (typeof contextOrFn === "function") {
    return {
      context: {},
      fn: contextOrFn,
    };
  }
  return {
    context: contextOrFn && typeof contextOrFn === "object" ? contextOrFn : {},
    fn: maybeFn,
  };
};

const handleRoute = async (res, contextOrFn, maybeFn) => {
  const { context, fn } = resolveHandleRouteArgs(contextOrFn, maybeFn);
  if (typeof fn !== "function") {
    throw new BlueprintError(500, "invalid_route_handler", "Route handler is missing");
  }
  setResponseTelemetryContext(res, {
    source: "node_api",
    startedAtMs: Date.now(),
    ...(context || {}),
  });
  try {
    await fn();
  } catch (err) {
    const { status, body } = toErrorPayload(err);
    setResponseTelemetryContext(res, {
      outcome: "failure",
      reason: body?.error || body?.message || "",
    });
    sendJson(res, status, body);
  }
};

const requireString = (value, fieldName) => {
  const v = String(value || "").trim();
  if (!v) {
    throw new BlueprintError(400, "invalid_input", `${fieldName} is required`);
  }
  return v;
};

module.exports = {
  methodNotAllowed,
  handleRoute,
  requireString,
};
