const crypto = require("crypto");

const decodeBase64Url = (input) => {
  const s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const extractBearerToken = (headerValue) => {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return String(m?.[1] || "").trim();
};

const normalizeIdentityCandidate = (value, { lower = false } = {}) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return lower ? raw.toLowerCase() : raw;
};

const fallbackTokenFingerprint = (token) => {
  const raw = String(token || "").trim();
  if (!raw) return "";
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  return `tok_${digest.slice(0, 48)}`;
};

const magicUserIdFromJwt = (jwt) => {
  const token = String(jwt || "").trim();
  if (!token) return "";

  const parts = token.split(".");
  if (parts.length >= 2) {
    const payload = safeJsonParse(decodeBase64Url(parts[1])) || {};

    // Keep backward compatibility first: existing balances keyed by `sub`.
    const sub = normalizeIdentityCandidate(payload?.sub);
    if (sub) return sub;

    // Accept common identity claim variants used by auth providers.
    const stableClaims = [
      payload?.user_id,
      payload?.userId,
      payload?.uid,
      payload?.did,
      payload?.issuer,
      payload?.iss,
      payload?.publicAddress,
      payload?.address,
      payload?.wallet_address,
    ];
    for (const claim of stableClaims) {
      const v = normalizeIdentityCandidate(claim);
      if (v) return v;
    }

    // Email fallback keeps a stable id even when `sub` is absent.
    const email = normalizeIdentityCandidate(payload?.email || payload?.email_address, { lower: true });
    if (email) return `email:${email}`;
  }

  // Last resort for opaque bearer tokens.
  return fallbackTokenFingerprint(token);
};

const magicUserEmailFromJwt = (jwt) => {
  const token = String(jwt || "").trim();
  const parts = token.split(".");
  if (parts.length < 2) return "";
  const payload = safeJsonParse(decodeBase64Url(parts[1]));
  const email = String(payload?.email || payload?.email_address || "").trim();
  return email || "";
};

const getMagicJwtFromRequest = (req) => {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const bearer = extractBearerToken(header);
  if (bearer) return bearer;
  const xMagicJwt = String(req?.headers?.["x-magic-jwt"] || "").trim();
  if (xMagicJwt) return xMagicJwt;
  return "";
};

const getMagicUserIdFromRequest = (req) => {
  const jwt = getMagicJwtFromRequest(req);
  if (!jwt) return "";
  return magicUserIdFromJwt(jwt);
};

module.exports = {
  getMagicJwtFromRequest,
  getMagicUserIdFromRequest,
  magicUserIdFromJwt,
  magicUserEmailFromJwt,
};
