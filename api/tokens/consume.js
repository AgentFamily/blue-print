const { getMagicUserIdFromRequest } = require("../../lib/magic_user");
const { spendTokens } = require("../../lib/token");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const userId = getMagicUserIdFromRequest(req);
  if (!userId) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Unauthorized (missing Magic bearer token)." }));
    return;
  }

  try {
    const out = await spendTokens(userId, 1);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ tokens: out.tokens }));
  } catch (err) {
    const status = err?.status || 500;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: err?.message || "Token store error",
        ...(typeof err?.tokens !== "undefined" ? { tokens: err.tokens } : {}),
      })
    );
  }
};
