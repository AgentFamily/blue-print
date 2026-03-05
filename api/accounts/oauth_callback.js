// simple OAuth callback handler – exchanges code, stores token reference.
const fetch = require("node-fetch"); // if needed
const { upsertAccount } = require("../_lib/accounts");
const { getProviderConfig } = require("../_lib/providers");

module.exports = async (req, res) => {
  const { code, state } = req.query || {};
  const provider = String(state || "").toLowerCase();
  if (!provider || !code) {
    res.statusCode = 400;
    res.end("Missing provider or code");
    return;
  }
  const cfg = getProviderConfig(provider);
  if (!cfg || cfg.type !== "oauth") {
    res.statusCode = 400;
    res.end("Unsupported provider");
    return;
  }

  try {
    // exchange code for token -- stubbed
    // in a real app you'd POST to cfg.tokenUrl with client_secret etc.
    // Here we just generate a fake tokenRef and mark connected.
    const tokenRef = `vault:${provider}:${Date.now()}`;
    const acct = {
      provider,
      status: "connected",
      connectedAt: Date.now(),
      lastSyncAt: null,
      scopes: cfg.defaultScopes || [],
      tokenRef,
      lastError: null,
      meta: { },
    };
    await upsertAccount(acct);
    res.setHeader("Content-Type", "text/plain");
    res.end(`Connected ${provider}`);
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Error connecting: " + String(err.message));
  }
};
