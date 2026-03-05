const { unlockVault, issueSessionToken, permissionForSecret } = require("../../lib/vault_broker");

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

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const parseCookieHeader = (header) => {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
};

const isSecureRequest = (req) => {
  try {
    const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
    if (proto) return proto.includes("https");
  } catch {
    // ignore
  }
  return false;
};

const appendSetCookie = (res, cookie) => {
  const value = String(cookie || "").trim();
  if (!value) return;
  try {
    const prev = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : null;
    if (!prev) {
      res.setHeader("Set-Cookie", value);
      return;
    }
    if (Array.isArray(prev)) {
      res.setHeader("Set-Cookie", [...prev, value]);
      return;
    }
    res.setHeader("Set-Cookie", [prev, value]);
  } catch {
    res.setHeader("Set-Cookie", value);
  }
};

const makeCookie = (name, value, { maxAgeSeconds, httpOnly = true, sameSite = "Lax", secure = false } = {}) => {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ""))}`, "Path=/"];
  const age = parseInt(String(maxAgeSeconds ?? ""), 10);
  if (Number.isFinite(age) && age > 0) parts.push(`Max-Age=${age}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

const ADMIN_COOKIE = "mk_admin";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  const isAdminCookie = String(cookies[ADMIN_COOKIE] || "") === "1";
  if (isAdminCookie) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: true, already: true }));
    return;
  }

  const adminCode = firstEnv("MK_ADMIN_CODE", "MK_ADM1N_CODE") || "I am MK";
  const body = await readJsonBody(req);
  const code = String(body?.code || "").trim();
  const ok = Boolean(code && code === adminCode);
  if (!ok) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: false, error: "Admin code rejected" }));
    return;
  }

  const secure = isSecureRequest(req);
  appendSetCookie(res, makeCookie(ADMIN_COOKIE, "1", { maxAgeSeconds: 60 * 60 * 24 * 30, secure }));
  let broker = null;
  try {
    await unlockVault({ actorType: "human", actorId: "admin-login" });
    const session = await issueSessionToken({
      actorType: "human",
      actorId: "admin-login",
      botId: "chat-assistant",
      ttlMs: 10 * 60 * 1000,
      permissions: [permissionForSecret("OPENAI_API_KEY")],
      oneTime: false,
    });
    appendSetCookie(
      res,
      makeCookie("agentc_vault_session", session.sessionToken, {
        maxAgeSeconds: Math.max(1, Math.ceil(Number(session.ttlMs || 0) / 1000)),
        secure,
      })
    );
    broker = {
      issued: true,
      expiresAt: session.expiresAt,
      ttlMs: session.ttlMs,
      permissions: session.permissions,
    };
  } catch (err) {
    broker = {
      issued: false,
      error: String(err?.message || err || "Vault broker unavailable"),
    };
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ ok: true, broker }));
};
