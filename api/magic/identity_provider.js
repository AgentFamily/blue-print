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

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const ADMIN_COOKIE = "mk_admin";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  // Protect this endpoint: do not allow public callers to hit Magic admin APIs.
  const cookies = parseCookieHeader(req?.headers?.cookie);
  const isAdminCookie = String(cookies[ADMIN_COOKIE] || "") === "1";
  if (!isAdminCookie) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Forbidden (admin only)." }));
    return;
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY", "X_MAGIC_SECRET_KEY");
  if (!secretKey || !/^sk_/i.test(secretKey)) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Missing MAGIC_SECRET_KEY (expected sk_…)" }));
    return;
  }

  const body = await readJsonBody(req);
  const issuer = typeof body?.issuer === "string" ? body.issuer.trim() : "";
  const audience = typeof body?.audience === "string" ? body.audience.trim() : "";
  const jwks_uri = typeof body?.jwks_uri === "string" ? body.jwks_uri.trim() : "";

  if (!issuer || !audience || !jwks_uri) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Missing issuer, audience, or jwks_uri" }));
    return;
  }

  // Basic URL sanity checks (avoid obvious garbage; Magic will fully validate).
  const looksLikeHttpsUrl = (u) => /^https:\/\/[^\s]+$/i.test(String(u || ""));
  if (!looksLikeHttpsUrl(issuer) || !looksLikeHttpsUrl(jwks_uri)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "issuer and jwks_uri must be https URLs" }));
    return;
  }

  try {
    const upstream = await fetch("https://tee.express.magiclabs.com/v1/identity/provider", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Magic-Secret-Key": secretKey
      },
      body: JSON.stringify({ issuer, audience, jwks_uri })
    });

    const text = await upstream.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    res.statusCode = upstream.status || 502;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(json ?? { raw: text }));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
};

