const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const getKvConfig = () => {
  const url = firstEnv("KV_REST_API_URL", "KV_RESTAPI_URL", "UPSTASH_REDIS_REST_URL");
  const token = firstEnv("KV_REST_API_TOKEN", "KV_RESTAPI_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
  return { url, token };
};

const encodePathPart = (part) => encodeURIComponent(String(part ?? ""));

const kvFetch = async (pathParts) => {
  const { url, token } = getKvConfig();
  if (!url || !token) {
    const err = new Error("KV is not configured (missing KV_REST_API_URL/KV_REST_API_TOKEN).");
    err.status = 500;
    throw err;
  }

  const cleanBase = String(url).replace(/\/+$/, "");
  const path = pathParts.map(encodePathPart).join("/");
  const res = await fetch(`${cleanBase}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = String(json?.error || json?.message || text || `HTTP ${res.status}`).trim() || "KV error";
    const err = new Error(msg);
    err.status = res.status;
    err.details = json ?? { raw: text };
    throw err;
  }

  return json ?? {};
};

const kvGet = async (key) => {
  const json = await kvFetch(["get", key]);
  return json?.result ?? null;
};

const kvGetInt = async (key, fallback = 0) => {
  const raw = await kvGet(key);
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

const kvIncrBy = async (key, amount) => {
  const delta = parseInt(String(amount ?? "0"), 10);
  if (!Number.isFinite(delta)) throw new Error("Invalid kvIncrBy amount");
  const json = await kvFetch(["incrby", key, String(delta)]);
  const n = typeof json?.result === "number" ? json.result : parseInt(String(json?.result ?? ""), 10);
  if (!Number.isFinite(n)) throw new Error("KV INCRBY returned non-integer result");
  return n;
};

const kvSet = async (key, value) => {
  const json = await kvFetch(["set", key, value]);
  return json?.result ?? null;
};

const kvSetNX = async (key, value, { exSeconds } = {}) => {
  const ex = parseInt(String(exSeconds ?? ""), 10);
  const parts = ["set", key, value];
  if (Number.isFinite(ex) && ex > 0) parts.push("EX", String(ex));
  parts.push("NX");
  const json = await kvFetch(parts);
  // Upstash returns null result when NX fails.
  return Boolean(json && json.result);
};

module.exports = {
  kvGet,
  kvGetInt,
  kvIncrBy,
  kvSet,
  kvSetNX,
};
