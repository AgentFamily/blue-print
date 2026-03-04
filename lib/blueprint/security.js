"use strict";

const crypto = require("crypto");
const { BlueprintError } = require("./errors");

const SESSION_COOKIE = "bp_session";
const CSRF_COOKIE = "bp_csrf";

const rateWindows = new Map();

const base64UrlEncode = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (input) => {
  const raw = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  return Buffer.from(padded, "base64");
};

const masterKeyring = () => {
  const key = String(process.env.KEYRING || "").trim();
  if (!key) {
    throw new BlueprintError(
      500,
      "missing_keyring",
      "KEYRING environment variable must be configured for auth and vault encryption"
    );
  }
  return key;
};

const deriveKey = (purpose) => {
  const material = `${masterKeyring()}::${String(purpose || "default")}`;
  return crypto.createHash("sha256").update(material).digest();
};

const randomToken = (bytes = 24) => base64UrlEncode(crypto.randomBytes(Math.max(8, Number(bytes || 24))));

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const signJwt = (payload, ttlSeconds = 60 * 60 * 8) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(30, Number(ttlSeconds || 0));
  const body = {
    ...payload,
    iat: now,
    exp,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(body));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", deriveKey("jwt")).update(input).digest();
  return `${input}.${base64UrlEncode(signature)}`;
};

const verifyJwt = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new BlueprintError(401, "invalid_session", "Invalid session token");
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const input = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto.createHmac("sha256", deriveKey("jwt")).update(input).digest();
  const suppliedSig = base64UrlDecode(encodedSig);
  if (expectedSig.length !== suppliedSig.length || !crypto.timingSafeEqual(expectedSig, suppliedSig)) {
    throw new BlueprintError(401, "invalid_session", "Session signature validation failed");
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    throw new BlueprintError(401, "invalid_session", "Session payload is not valid JSON");
  }
  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    throw new BlueprintError(401, "session_expired", "Session has expired");
  }
  return payload;
};

const ensureCsrf = (req, cookies, { allowMissingCookie = false } = {}) => {
  const method = String(req?.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const cookieToken = String(cookies?.[CSRF_COOKIE] || "");
  const headerToken = String(req?.headers?.["x-csrf-token"] || "");

  if (!cookieToken && allowMissingCookie) return;
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new BlueprintError(403, "csrf_failed", "CSRF token validation failed");
  }
};

const checkRateLimit = ({ namespace, key, limit, windowMs }) => {
  const ns = String(namespace || "default");
  const k = `${ns}:${String(key || "anon")}`;
  const max = Math.max(1, Number(limit || 1));
  const window = Math.max(1000, Number(windowMs || 60000));
  const now = Date.now();
  const start = now - window;

  const arr = rateWindows.get(k) || [];
  const trimmed = arr.filter((ts) => ts >= start);
  trimmed.push(now);
  rateWindows.set(k, trimmed);

  const count = trimmed.length;
  const ok = count <= max;
  const retryAfterMs = ok ? 0 : Math.max(1, window - (now - trimmed[0]));
  return {
    ok,
    remaining: Math.max(0, max - count),
    retryAfterSec: Math.ceil(retryAfterMs / 1000),
    limit: max,
  };
};

module.exports = {
  SESSION_COOKIE,
  CSRF_COOKIE,
  randomToken,
  deriveKey,
  signJwt,
  verifyJwt,
  ensureCsrf,
  checkRateLimit,
  safeEqual,
};
