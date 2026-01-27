const { kvGet, kvGetInt, kvIncrBy, kvSet, kvSetNX } = require("./upstash_kv");

const INITIAL_TOKENS = 77;
const LEDGER_MAX_ENTRIES = 200;

const tokenKey = (userId) => `agentc:tokens:${userId}`;
const lastUsedKey = (userId) => `agentc:last_used:${userId}`;
const ledgerKey = (userId) => `agentc:ledger:${userId}`;

const truthyEnv = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
};

const ledgerEnabled = () => truthyEnv(process.env.AGENTC_TOKEN_LEDGER || process.env.MK_TOKEN_LEDGER);

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const logLedger = async (userId, entry) => {
  if (!ledgerEnabled()) return false;
  const uid = String(userId || "").trim();
  if (!uid) return false;

  const e = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...entry,
  };

  try {
    const raw = await kvGet(ledgerKey(uid));
    const list = Array.isArray(raw) ? raw : safeJsonParse(raw);
    const next = Array.isArray(list) ? [e, ...list].slice(0, LEDGER_MAX_ENTRIES) : [e];
    await kvSet(ledgerKey(uid), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

const grantInitialTokens = async (userId, amount = INITIAL_TOKENS) => {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const n = parseInt(String(amount ?? INITIAL_TOKENS), 10);
  const value = Number.isFinite(n) && n > 0 ? String(n) : String(INITIAL_TOKENS);
  const ok = await kvSetNX(tokenKey(uid), value);
  if (ok) await logLedger(uid, { type: "grant_initial", delta: parseInt(value, 10) || 0 });
  return ok;
};

const ensureNotNegative = async (userId, nextBalance) => {
  if (typeof nextBalance !== "number" || !Number.isFinite(nextBalance)) return;
  if (nextBalance >= 0) return;
  // Hardening: freeze at 0 to avoid negative balances under async drift / double-clicks.
  await kvSet(tokenKey(userId), "0");
  await logLedger(userId, { type: "freeze_zero", reason: "negative_balance_guard" });
  const err = new Error("Insufficient tokens. Please top up.");
  err.status = 402;
  err.tokens = 0;
  throw err;
};

const spendTokens = async (userId, amount = 1) => {
  const uid = String(userId || "").trim();
  if (!uid) {
    const err = new Error("Missing user id");
    err.status = 401;
    throw err;
  }

  await grantInitialTokens(uid);

  const n = parseInt(String(amount ?? 1), 10);
  const spend = Number.isFinite(n) && n > 0 ? n : 1;
  const next = await kvIncrBy(tokenKey(uid), -spend);
  await ensureNotNegative(uid, next);

  const now = new Date().toISOString();
  try {
    await kvSet(lastUsedKey(uid), now);
  } catch {
    // ignore
  }
  await logLedger(uid, { type: "spend", delta: -spend, balance: next });
  return { tokens: next, last_used: now };
};

const creditTokens = async (userId, amount, meta = {}) => {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("Missing user id");
  const n = parseInt(String(amount ?? 0), 10);
  const delta = Number.isFinite(n) ? n : 0;
  if (delta <= 0) throw new Error("Invalid credit amount");
  const next = await kvIncrBy(tokenKey(uid), delta);
  await logLedger(uid, { type: "credit", delta, balance: next, ...meta });
  return next;
};

const getBalance = async (userId) => {
  const uid = String(userId || "").trim();
  if (!uid) {
    const err = new Error("Missing user id");
    err.status = 401;
    throw err;
  }

  await grantInitialTokens(uid);
  const tokens = await kvGetInt(tokenKey(uid), 0);
  const last = await kvGet(lastUsedKey(uid));
  const lastUsed = typeof last === "string" && last.trim() ? last.trim() : null;
  return { tokens, last_used: lastUsed };
};

module.exports = {
  INITIAL_TOKENS,
  tokenKey,
  lastUsedKey,
  grantInitialTokens,
  spendTokens,
  creditTokens,
  getBalance,
  logLedger,
};

