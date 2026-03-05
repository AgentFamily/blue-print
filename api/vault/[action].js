const { getSecret, setSecret, listSecrets, deleteSecret } = require("../../lib/vault");
const { requireVaultPassword } = require("../../lib/vault_auth");

const getAction = (req) => {
  const raw = req?.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || "").trim().toLowerCase();
  return String(raw || "").trim().toLowerCase();
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
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

module.exports = async (req, res) => {
  try {
    if (!requireVaultPassword(req, res)) return;

    const action = getAction(req);
    const body = await readJsonBody(req);

    if (action === "get") {
      if (req.method !== "GET" && req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        return res.end("Method Not Allowed");
      }
      const name = String(req.query?.name || body?.name || "");
      if (!name) {
        res.statusCode = 400;
        return res.end("name required");
      }
      const value = await getSecret(name);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ value }));
    }

    if (action === "set") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      const { name, value } = body || {};
      if (!name || typeof value === "undefined") {
        res.statusCode = 400;
        return res.end("name and value required");
      }
      await setSecret(name, value);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }

    if (action === "list") {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        return res.end("Method Not Allowed");
      }
      const names = await listSecrets();
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(names));
    }

    if (action === "delete") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      const { name } = body || {};
      if (!name) {
        res.statusCode = 400;
        return res.end("name required");
      }
      await deleteSecret(name);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }

    res.statusCode = 404;
    res.end(`Unknown vault action: ${action || "none"}`);
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.end(err?.message || String(err));
  }
};
