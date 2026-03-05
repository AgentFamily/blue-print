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

const { accounts, providers } = require("../_lib");
const { upsertAccount } = accounts;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !body.provider) {
    res.statusCode = 400;
    res.end("Missing provider in request body");
    return;
  }

  const { getProviderConfig } = providers;
  const prov = String(body.provider).toLowerCase();
  const cfg = getProviderConfig(prov);

  // handle oauth initiation separately
  if (body.mode === "oauth" && cfg && cfg.type === "oauth") {
    // build redirect URL with requested scopes
    const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes : cfg.defaultScopes || [];
    const params = new URLSearchParams({
      client_id: process.env[`${prov.toUpperCase()}_CLIENT_ID`] || "",
      redirect_uri: process.env[`${prov.toUpperCase()}_REDIRECT_URI`] || "",
      scope: scopes.join(" "),
      response_type: "code",
      state: prov,
    });
    const redirect = `${cfg.authorizeUrl}?${params.toString()}`;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ redirect }));
    return;
  }

  try {
    const acct = {
      provider: prov,
      status: "connected",
      connectedAt: Date.now(),
      lastSyncAt: null,
      scopes: Array.isArray(body.scopes) ? body.scopes : [],
      tokenRef: body.tokenRef || null,
      lastError: null,
      meta: typeof body.meta === "object" && body.meta ? body.meta : {},
    };

    const saved = await upsertAccount(acct);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(saved));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};