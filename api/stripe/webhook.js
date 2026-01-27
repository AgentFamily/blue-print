const crypto = require("crypto");
const { kvGet, kvIncrBy, kvSetNX } = require("../_lib/upstash_kv");

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const readRawBody = async (req) => {
  if (typeof req?.body === "string") return req.body;
  if (req?.body && typeof req.body === "object") return JSON.stringify(req.body);
  let raw = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", resolve);
  });
  return raw;
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const timingSafeEqualHex = (aHex, bHex) => {
  try {
    const a = Buffer.from(String(aHex || ""), "hex");
    const b = Buffer.from(String(bHex || ""), "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

const computeStripeSig = ({ secret, timestamp, payload }) =>
  crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");

const verifyStripeSignature = ({ secret, signatureHeader, payload }) => {
  const header = String(signatureHeader || "").trim();
  if (!header) return false;
  const pairs = header
    .split(",")
    .map((p) => p.split("=").map((x) => String(x || "").trim()))
    .filter((kv) => kv.length === 2 && kv[0]);

  let timestamp = "";
  const v1s = [];
  for (const [k, v] of pairs) {
    if (k === "t") timestamp = String(v || "").trim();
    if (k === "v1") v1s.push(String(v || "").trim());
  }

  if (!timestamp || v1s.length === 0) return false;
  const expected = computeStripeSig({ secret, timestamp, payload });
  return v1s.some((sig) => timingSafeEqualHex(expected, sig));
};

const tokenKey = (userId) => `agentc:tokens:${userId}`;
const creditedKey = (sessionId) => `agentc:stripe:credited:${sessionId}`;
const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;

const parseAllowedPaymentLinks = () => {
  const raw = firstEnv("STRIPE_ALLOWED_PAYMENT_LINKS");
  if (!raw) return null;
  const json = safeJsonParse(raw);
  if (!json || typeof json !== "object") return null;
  return json;
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const webhookSecret = firstEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing STRIPE_WEBHOOK_SECRET" }));
    return;
  }

  const signatureHeader = req?.headers?.["stripe-signature"] || req?.headers?.["Stripe-Signature"] || "";
  const rawBody = await readRawBody(req);

  if (!verifyStripeSignature({ secret: webhookSecret, signatureHeader, payload: rawBody })) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid Stripe signature" }));
    return;
  }

  const event = safeJsonParse(rawBody);
  if (!event || typeof event !== "object") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON payload" }));
    return;
  }

  // Acknowledge unrelated events.
  if (String(event.type || "") !== "checkout.session.completed") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true }));
    return;
  }

  const session = event?.data?.object;
  const sessionId = String(session?.id || "").trim();
  const paymentStatus = String(session?.payment_status || "").trim();
  let userId = String(session?.client_reference_id || "").trim();
  const paymentLinkId = String(session?.payment_link || "").trim();

  if (!sessionId || paymentStatus !== "paid") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true }));
    return;
  }

  if (!userId) {
    const email =
      String(session?.customer_details?.email || "").trim() ||
      String(session?.customer_email || "").trim();
    if (email) {
      try {
        userId = String((await kvGet(emailKey(email))) || "").trim();
      } catch {
        userId = "";
      }
    }
  }

  if (!userId) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true, unattributed: true }));
    return;
  }

  let tokensToCredit = 0;
  const metaTokens = parseInt(String(session?.metadata?.agentc_tokens || ""), 10);
  if (Number.isFinite(metaTokens) && metaTokens > 0) {
    tokensToCredit = metaTokens;
  } else {
    const allowed = parseAllowedPaymentLinks();
    if (allowed) {
      const n = parseInt(String(allowed[paymentLinkId] ?? ""), 10);
      if (Number.isFinite(n) && n > 0) tokensToCredit = n;
    } else {
      const requiredLinkId = firstEnv("STRIPE_PAYMENT_LINK_ID");
      if (requiredLinkId && paymentLinkId && paymentLinkId !== requiredLinkId) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ received: true }));
        return;
      }
      const fallback = parseInt(firstEnv("STRIPE_PAYMENT_LINK_TOKENS") || "200", 10);
      tokensToCredit = Number.isFinite(fallback) && fallback > 0 ? fallback : 200;
    }
  }

  try {
    const firstTime = await kvSetNX(creditedKey(sessionId), String(event.id || "1"), { exSeconds: 60 * 60 * 24 * 7 });
    if (!firstTime) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ received: true, duplicate: true }));
      return;
    }

    const newBalance = await kvIncrBy(tokenKey(userId), tokensToCredit);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true, userId, tokensCredited: tokensToCredit, tokens: newBalance }));
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err?.message || "Webhook processing failed" }));
  }
};
