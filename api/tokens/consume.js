const { getMagicUserIdFromRequest } = require("../_lib/magic_user");
const { kvIncrBy, kvSetNX } = require("../_lib/upstash_kv");

const tokenKey = (userId) => `agentc:tokens:${userId}`;
const INITIAL_TOKENS = 77;

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
    try {
      await kvSetNX(tokenKey(userId), String(INITIAL_TOKENS));
    } catch {
      // ignore init failures
    }

    const next = await kvIncrBy(tokenKey(userId), -1);
    if (next < 0) {
      await kvIncrBy(tokenKey(userId), 1);
      res.statusCode = 402;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: "No AgentC-oins remaining.", tokens: 0 }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ tokens: next }));
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err?.message || "Token store error" }));
  }
};
