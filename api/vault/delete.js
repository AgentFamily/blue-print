const { deleteSecret } = require("../lib/vault");
const { requireVaultPassword } = require("../lib/vault_auth");

module.exports = async (req, res) => {
  try {
    if (!requireVaultPassword(req, res)) return;
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("POST only");
    }
    const { name } = req.body || {};
    if (!name) {
      res.statusCode = 400;
      return res.end("name required");
    }
    await deleteSecret(name);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(err.message);
  }
};
