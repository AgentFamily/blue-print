const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../../lib/magic_user");
const { kvSet } = require("../../lib/upstash_kv");
const { getBalance, spendTokens } = require("../../lib/token");
const { COIN_PRODUCT_PACKS } = require("../../lib/product_packs");

const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const getAction = (req) => {
  const raw = req?.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || "").trim().toLowerCase();
  return String(raw || "").trim().toLowerCase();
};

module.exports = async (req, res) => {
  const action = getAction(req);

  if (action === "packs") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end("Method Not Allowed");
      return;
    }
    sendJson(res, 200, { packs: COIN_PRODUCT_PACKS });
    return;
  }

  if (action === "balance") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end("Method Not Allowed");
      return;
    }

    const userId = getMagicUserIdFromRequest(req);
    if (!userId) {
      sendJson(res, 401, { error: "Unauthorized (missing Magic bearer token)." });
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
      sendJson(res, 200, { tokens: bal.tokens });
    } catch (err) {
      sendJson(res, err?.status || 500, { error: err?.message || "Token store error" });
    }
    return;
  }

  if (action === "consume") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return;
    }

    const userId = getMagicUserIdFromRequest(req);
    if (!userId) {
      sendJson(res, 401, { error: "Unauthorized (missing Magic bearer token)." });
      return;
    }

    try {
      const out = await spendTokens(userId, 1);
      sendJson(res, 200, { tokens: out.tokens });
    } catch (err) {
      sendJson(res, err?.status || 500, {
        error: err?.message || "Token store error",
        ...(typeof err?.tokens !== "undefined" ? { tokens: err.tokens } : {}),
      });
    }
    return;
  }

  sendJson(res, 404, { error: `Unknown tokens action: ${action || "none"}` });
};
