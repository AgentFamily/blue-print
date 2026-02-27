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

const truthyEnv = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
};

module.exports = async (req, res) => {
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

  if (!jwt) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing jwt" }));
    return;
  }
  if (!providerId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing provider_id" }));
    return;
  }

  if (truthyEnv(firstEnv("MAGIC_WALLET_DISABLED", "MAGIC_DISABLE_WALLET"))) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Magic wallet is disabled by server configuration." }));
    return;
  }

  const secretKey = firstEnv("MAGIC_SECRET_KEY", "X_MAGIC_SECRET_KEY");
  const publishableKey = firstEnv("MAGIC_PUBLISHABLE_KEY", "MAGIC_API_KEY");
  if (!secretKey && !publishableKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing MAGIC_SECRET_KEY (preferred) or MAGIC_PUBLISHABLE_KEY" }));
    return;
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
    res.statusCode = upstream.status || 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data || { error: "Invalid JSON from Magic upstream" }));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
};
