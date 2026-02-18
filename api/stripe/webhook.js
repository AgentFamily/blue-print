const crypto = require("crypto");
const { kvGet, kvSetNX } = require("../../lib/upstash_kv");
const { creditTokens } = require("../../lib/token");

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

const creditedKey = (sessionId) => `agentc:stripe:credited:${sessionId}`;
const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;

const linkAliases = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const out = new Set([raw]);
  if (/^https?:/i.test(raw)) {
    try {
      const url = new URL(raw);
      out.add(`${url.origin}${url.pathname}`);
      const last = url.pathname.split("/").filter(Boolean).pop();
      if (last) out.add(last);
    } catch {
      // ignore invalid URL
    }
  }
  return [...out];
};

const parseAllowedPaymentLinks = () => {
  const map = {};
  const raw = firstEnv("STRIPE_ALLOWED_PAYMENT_LINKS");
  if (raw) {
    const json = safeJsonParse(raw);
    if (json && typeof json === "object") {
      for (const [key, value] of Object.entries(json)) {
        const n = parseInt(String(value ?? ""), 10);
        if (!Number.isFinite(n) || n <= 0) continue;
        for (const alias of linkAliases(key)) map[alias] = n;
      }
    }
  }

  const directId = firstEnv("STRIPE_PAYMENT_LINK_ID");
  const directTokens = firstEnv("STRIPE_PAYMENT_LINK_TOKENS");
  if (directId && directTokens) {
    const n = parseInt(String(directTokens), 10);
    if (Number.isFinite(n) && n > 0) {
      for (const alias of linkAliases(directId)) map[alias] = n;
    }
  }

  for (const key of Object.keys(process.env || {})) {
    const match = key.match(/^STRIPE_PAYMENT_LINK_ID_(\d+)$/i);
    if (!match) continue;
    const suffix = match[1];
    const id = firstEnv(`STRIPE_PAYMENT_LINK_ID_${suffix}`);
    const tokens = firstEnv(`STRIPE_PAYMENT_LINK_TOKENS_${suffix}`);
    if (!id || !tokens) continue;
    const n = parseInt(String(tokens), 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    for (const alias of linkAliases(id)) map[alias] = n;
  }

  return Object.keys(map).length ? map : null;
};

const resolveAllowedTokens = (allowed, paymentLinkValue) => {
  if (!allowed || !paymentLinkValue) return 0;
  for (const alias of linkAliases(paymentLinkValue)) {
    const n = parseInt(String(allowed[alias] ?? ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
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
  const paymentLinkId = String(session?.payment_link || session?.payment_link_url || session?.metadata?.payment_link || "").trim();
  const metaUserId =
    String(session?.metadata?.user_id || "").trim() ||
    String(session?.metadata?.userId || "").trim();

  if (!sessionId || paymentStatus !== "paid") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true }));
    return;
  }

  if (metaUserId) userId = metaUserId;

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
  const topupAmount = parseInt(
    String(session?.metadata?.topup_amount || session?.metadata?.topupAmount || ""),
    10
  );
  if (Number.isFinite(topupAmount) && topupAmount > 0) {
    tokensToCredit = topupAmount;
  } else {
    const metaTokens = parseInt(String(session?.metadata?.agentc_tokens || ""), 10);
    if (Number.isFinite(metaTokens) && metaTokens > 0) {
      tokensToCredit = metaTokens;
    }

    const allowed = parseAllowedPaymentLinks();
    if (!tokensToCredit && allowed) {
      const n = resolveAllowedTokens(allowed, paymentLinkId);
      if (Number.isFinite(n) && n > 0) tokensToCredit = n;
    } else if (!tokensToCredit) {
      const requiredLinkId = firstEnv("STRIPE_PAYMENT_LINK_ID");
      if (requiredLinkId && paymentLinkId) {
        const expected = linkAliases(requiredLinkId);
        const matches = expected.some((alias) => linkAliases(paymentLinkId).includes(alias));
        if (!matches) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ received: true }));
        return;
        }
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

    const newBalance = await creditTokens(userId, tokensToCredit, {
      source: "stripe",
      session_id: sessionId,
      payment_link: paymentLinkId || null,
      event_id: String(event?.id || "").trim() || null,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true, userId, tokensCredited: tokensToCredit, tokens: newBalance }));
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err?.message || "Webhook processing failed" }));
  }
};
