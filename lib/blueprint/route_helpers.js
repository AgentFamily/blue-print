"use strict";

const { sendJson } = require("./http");
const { toErrorPayload, BlueprintError } = require("./errors");

const methodNotAllowed = (res, allow) => {
  res.statusCode = 405;
  res.setHeader("Allow", allow);
  res.end("Method Not Allowed");
};

const handleRoute = async (res, fn) => {
  try {
    await fn();
  } catch (err) {
    const { status, body } = toErrorPayload(err);
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
