const { listSecrets } = require("../lib/vault");
const { requireVaultPassword } = require("../lib/vault_auth");

module.exports = async (req, res) => {
  try {
    if (!requireVaultPassword(req, res)) return;
    const names = await listSecrets();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(names));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(err.message);
  }
};
