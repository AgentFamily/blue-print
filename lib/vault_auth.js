const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const defaultVaultPassword = "ThisisnotMK";

const expectedVaultPassword = () => firstEnv("VAULT_PANEL_PASSWORD", "MK_VAULT_PASSWORD") || defaultVaultPassword;

const getHeader = (req, name) => {
  try {
    const value = req?.headers?.[String(name || "").toLowerCase()];
    return String(value || "").trim();
  } catch {
    return "";
  }
};

const requireVaultPassword = (req, res) => {
  const provided = getHeader(req, "x-agentc-vault-pass");
  const expected = expectedVaultPassword();
  if (!provided || provided !== expected) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Vault access denied." }));
    return false;
  }
  return true;
};

module.exports = {
  requireVaultPassword,
};
