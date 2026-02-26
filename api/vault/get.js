const { getSecret } = require("../lib/vault");
const { requireVaultPassword } = require("../lib/vault_auth");

module.exports = async (req, res) => {
  try {
    if (!requireVaultPassword(req, res)) return;
    const name = String(req.query?.name || req.body?.name || "");
    if (!name) {
      res.statusCode = 400;
      return res.end("name required");
    }
    const value = await getSecret(name);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ value }));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(err.message);
  }
};
