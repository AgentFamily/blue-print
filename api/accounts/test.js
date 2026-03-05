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
const { getAccount, upsertAccount } = accounts;

// lightweight provider health‑check; provider-specific logic can be
// implemented in separate modules and registered in the provider config.
const { getProviderConfig } = providers;

const testHandlers = {
  default: async (acct) => {
    return { status: acct.status || "connected", lastSyncAt: Date.now(), lastError: null };
  },
  // if a provider config exports a `test` function it will be called below
};

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

  try {
    const provider = String(body.provider).toLowerCase();
    const acct = await getAccount(provider);
    if (!acct) {
      res.statusCode = 404;
      res.end("Provider not connected");
      return;
    }

    // allow provider config to override test behaviour
    let result;
    const cfg = getProviderConfig(provider) || {};
    if (typeof cfg.test === "function") {
      result = await cfg.test(acct);
    } else {
      const handler = testHandlers.default;
      result = await handler(acct);
    }
    // merge fields back into account object
    acct.status = result.status;
    acct.lastSyncAt = result.lastSyncAt;
    acct.lastError = result.lastError;
    await upsertAccount(acct);

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(acct));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};