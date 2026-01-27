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

const magicUserIdFromJwt = (jwt) => {
  const token = String(jwt || "").trim();
  const parts = token.split(".");
  if (parts.length < 2) return "";
  const payload = safeJsonParse(decodeBase64Url(parts[1]));
  const sub = String(payload?.sub || "").trim();
  return sub || "";
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
