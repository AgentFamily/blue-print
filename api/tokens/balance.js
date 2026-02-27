const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../../lib/magic_user");
const { kvSet } = require("../../lib/upstash_kv");
const { getBalance } = require("../../lib/token");

const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;

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
    const jwt = getMagicJwtFromRequest(req);
    const email = jwt ? magicUserEmailFromJwt(jwt) : "";
    if (email) {
      try {
        await kvSet(emailKey(email), userId);
      } catch {
        // ignore mapping failures
      }
    }

    const bal = await getBalance(userId);
    const tokens = bal.tokens;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ tokens }));
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err?.message || "Token store error" }));
  }
};
