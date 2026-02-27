const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const truthyEnv = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
};

const findEnvValueMatching = (regex) => {
  for (const value of Object.values(process.env || {})) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && regex.test(trimmed)) return trimmed;
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

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const getAction = (req) => {
  const raw = req?.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || "").trim().toLowerCase();
  return String(raw || "").trim().toLowerCase();
};

const ADMIN_COOKIE = "mk_admin";

const handleConfig = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const publishableKey =
    firstEnv("MAGIC_PUBLISHABLE_KEY", "NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY", "MAGIC_API_KEY") ||
    findEnvValueMatching(/^pk_(live|test)_[A-Za-z0-9]+$/);

  if (!publishableKey) {
    sendJson(res, 500, { error: "Missing MAGIC_PUBLISHABLE_KEY" });
    return;
  }

  sendJson(res, 200, {
    publishableKey,
    providerId: firstEnv("MAGIC_PROVIDER_ID", "OIDC_PROVIDER_ID"),
    chain: firstEnv("MAGIC_CHAIN") || "ETH",
    walletDisabled: truthyEnv(firstEnv("MAGIC_WALLET_DISABLED", "MAGIC_DISABLE_WALLET")),
  });
};

const handleWallet = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  const jwt = typeof body?.jwt === "string" ? body.jwt.trim() : "";
  const providerId = typeof body?.provider_id === "string" ? body.provider_id.trim() : "";
  const chain = typeof body?.chain === "string" ? body.chain.trim() : "ETH";

  if (!jwt) return sendJson(res, 400, { error: "Missing jwt" });
  if (!providerId) return sendJson(res, 400, { error: "Missing provider_id" });

  if (truthyEnv(firstEnv("MAGIC_WALLET_DISABLED", "MAGIC_DISABLE_WALLET"))) {
    return sendJson(res, 403, { error: "Magic wallet is disabled by server configuration." });
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY", "X_MAGIC_SECRET_KEY");
  const publishableKey = firstEnv("MAGIC_PUBLISHABLE_KEY", "MAGIC_API_KEY");
  if (!secretKey && !publishableKey) {
    return sendJson(res, 500, { error: "Missing MAGIC_SECRET_KEY (preferred) or MAGIC_PUBLISHABLE_KEY" });
  }

  try {
    const upstream = await fetch("https://tee.express.magiclabs.com/v1/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        ...(secretKey ? { "X-Magic-Secret-Key": secretKey } : { "X-Magic-API-Key": publishableKey }),
        "X-OIDC-Provider-ID": providerId,
        "X-Magic-Chain": chain || "ETH",
      },
      body: "{}",
    });
    const data = await upstream.json().catch(() => null);
    sendJson(res, upstream.status || 502, data || { error: "Invalid JSON from Magic upstream" });
  } catch (err) {
    sendJson(res, 502, { error: err?.message || String(err) });
  }
};

const handleAccessWhitelist = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  if (String(cookies[ADMIN_COOKIE] || "") !== "1") {
    sendJson(res, 403, { error: "Forbidden (admin only)." });
    return;
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY");
  if (!secretKey || !/^sk_/i.test(secretKey)) {
    sendJson(res, 500, { error: "Missing MAGIC_SECRET_KEY (expected sk_…)" });
    return;
  }

  try {
    const upstream = await fetch("https://api.dashboard.magic.link/v1/admin/access_whitelist", {
      method: "GET",
      headers: {
        "X-Magic-Secret-Key": secretKey,
        Accept: "application/json",
      },
    });
    const text = await upstream.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!upstream.ok) {
      sendJson(res, upstream.status || 502, {
        error: `Magic Dashboard API error (HTTP ${upstream.status || 502})`,
        details: json ?? { raw: text },
      });
      return;
    }
    sendJson(res, 200, json ?? {});
  } catch (err) {
    sendJson(res, 502, { error: "Request failed", details: String(err?.message || err) });
  }
};

const handleIdentityProvider = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  if (String(cookies[ADMIN_COOKIE] || "") !== "1") {
    sendJson(res, 403, { error: "Forbidden (admin only)." });
    return;
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY", "X_MAGIC_SECRET_KEY");
  if (!secretKey || !/^sk_/i.test(secretKey)) {
    sendJson(res, 500, { error: "Missing MAGIC_SECRET_KEY (expected sk_…)" });
    return;
  }

  const body = await readJsonBody(req);
  const issuer = typeof body?.issuer === "string" ? body.issuer.trim() : "";
  const audience = typeof body?.audience === "string" ? body.audience.trim() : "";
  const jwks_uri = typeof body?.jwks_uri === "string" ? body.jwks_uri.trim() : "";
  if (!issuer || !audience || !jwks_uri) {
    sendJson(res, 400, { error: "Missing issuer, audience, or jwks_uri" });
    return;
  }

  const looksLikeHttpsUrl = (u) => /^https:\/\/[^\s]+$/i.test(String(u || ""));
  if (!looksLikeHttpsUrl(issuer) || !looksLikeHttpsUrl(jwks_uri)) {
    sendJson(res, 400, { error: "issuer and jwks_uri must be https URLs" });
    return;
  }

  try {
    const upstream = await fetch("https://tee.express.magiclabs.com/v1/identity/provider", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Magic-Secret-Key": secretKey,
      },
      body: JSON.stringify({ issuer, audience, jwks_uri }),
    });
    const text = await upstream.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    sendJson(res, upstream.status || 502, json ?? { raw: text });
  } catch (err) {
    sendJson(res, 502, { error: err?.message || String(err) });
  }
};

module.exports = async (req, res) => {
  const action = getAction(req);

  if (action === "config") return handleConfig(req, res);
  if (action === "wallet") return handleWallet(req, res);
  if (action === "access_whitelist") return handleAccessWhitelist(req, res);
  if (action === "identity_provider") return handleIdentityProvider(req, res);

  sendJson(res, 404, { error: `Unknown magic action: ${action || "none"}` });
};
