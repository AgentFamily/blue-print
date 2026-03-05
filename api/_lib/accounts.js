const { kvGet, kvSet } = require("./upstash_kv");

const ACCOUNT_ALL_KEY = "acct:all";
const ACCOUNT_KEY = (provider) => `acct:${String(provider || "").toLowerCase()}`;

async function listAccounts() {
  const raw = await kvGet(ACCOUNT_ALL_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

async function getAccount(provider) {
  if (!provider) return null;
  const raw = await kvGet(ACCOUNT_KEY(provider));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function upsertAccount(account) {
  if (!account || !account.provider) {
    throw new Error("account object must include provider");
  }
  const prov = String(account.provider).toLowerCase();
  const key = ACCOUNT_KEY(prov);
  const now = Date.now();
  const base = {
    provider: prov,
    status: "connected",
    connectedAt: now,
    lastSyncAt: null,
    scopes: [],
    tokenRef: null,
    lastError: null,
    meta: {},
  };
  const toStore = Object.assign(base, account);
  await kvSet(key, JSON.stringify(toStore));

  // ensure provider is listed in acct:all
  const list = await listAccounts();
  if (!list.includes(prov)) {
    list.push(prov);
    await kvSet(ACCOUNT_ALL_KEY, JSON.stringify(list));
  }
  return toStore;
}

async function disconnectAccount(provider) {
  if (!provider) return null;
  const prov = String(provider).toLowerCase();
  const existing = await getAccount(prov);
  if (!existing) return null;
  existing.status = "disconnected";
  existing.tokenRef = null;
  existing.lastError = null;
  existing.connectedAt = null;
  existing.lastSyncAt = null;
  await upsertAccount(existing);
  return existing;
}

module.exports = {
  listAccounts,
  getAccount,
  upsertAccount,
  disconnectAccount,
};
