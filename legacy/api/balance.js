const { getMagicUserIdFromRequest } = require("../../lib/magic_user");
const { getBalance } = require("../../lib/token");

// Legacy snapshot of the old /api/balance handler.
// Deployment now uses /api/tokens/balance (and a Vercel rewrite).
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
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
    const bal = await getBalance(userId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        magic_user_id: userId,
        token_balance: bal.tokens,
        last_used: bal.last_used
      })
    );
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err?.message || "Balance lookup failed" }));
  }
};
