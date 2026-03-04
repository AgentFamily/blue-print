"use strict";

const { parseCookies } = require("../http");
const { BlueprintError } = require("../errors");
const { SESSION_COOKIE } = require("../security");
const { getSessionFromToken } = require("./auth_service");

const authFromRequest = (req) => {
  const cookies = parseCookies(req);
  const token = String(cookies?.[SESSION_COOKIE] || "");
  if (!token) return null;
  return {
    ...getSessionFromToken(token),
    token,
    cookies,
  };
};

const requireAuthFromRequest = (req) => {
  const auth = authFromRequest(req);
  if (!auth) {
    throw new BlueprintError(401, "unauthorized", "Authentication required");
  }
  return auth;
};

module.exports = {
  authFromRequest,
  requireAuthFromRequest,
};
