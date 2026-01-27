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
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  const isAdminCookie = String(cookies[ADMIN_COOKIE] || "") === "1";
  if (!isAdminCookie) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Forbidden (admin only). Use the MK admin code first." }));
    return;
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY");
  if (!secretKey || !/^sk_/i.test(secretKey)) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Missing MAGIC_SECRET_KEY (expected sk_…)" }));
    return;
  }

  try {
    const upstream = await fetch("https://api.dashboard.magic.link/v1/admin/access_whitelist", {
      method: "GET",
      headers: {
        "X-Magic-Secret-Key": secretKey,
        Accept: "application/json"
      }
    });

    const text = await upstream.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!upstream.ok) {
      res.statusCode = upstream.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          error: `Magic Dashboard API error (HTTP ${upstream.status || 502})`,
          details: json ?? { raw: text }
        })
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(json ?? {}));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Request failed", details: String(err?.message || err) }));
  }
};

