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

const findEnvValueMatching = (regex) => {
  for (const value of Object.values(process.env || {})) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && regex.test(trimmed)) return trimmed;
  }
  return "";
};

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const publishableKey =
    firstEnv("MAGIC_PUBLISHABLE_KEY", "NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY", "MAGIC_API_KEY") ||
    findEnvValueMatching(/^pk_(live|test)_[A-Za-z0-9]+$/);

  if (!publishableKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Missing MAGIC_PUBLISHABLE_KEY" }));
    return;
  }

  const providerId = firstEnv("MAGIC_PROVIDER_ID", "OIDC_PROVIDER_ID");
  const chain = firstEnv("MAGIC_CHAIN") || "ETH";
  const walletDisabled = truthyEnv(firstEnv("MAGIC_WALLET_DISABLED", "MAGIC_DISABLE_WALLET"));

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      publishableKey,
      providerId,
      chain,
      walletDisabled,
    })
  );
};
