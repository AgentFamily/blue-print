const { kvGet, kvSet } = require("../lib/upstash_kv");

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const normalizeRole = (value) => {
  const v = String(value || "").trim().toLowerCase();
  return v === "admin" ? "admin" : "user";
};

const normalizeUserId = (value) => {
  const v = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._@-]/g, "")
    .slice(0, 120);
  return v;
};

const readJsonBody = async (req) => {
  if (req?.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", resolve);
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const queryValue = (req, name) => {
  if (req?.query && Object.prototype.hasOwnProperty.call(req.query, name)) {
    return String(req.query[name] || "").trim();
  }
  try {
    const base = "http://local";
    const url = new URL(String(req?.url || ""), base);
    return String(url.searchParams.get(name) || "").trim();
  } catch {
    return "";
  }
};

const parseLayout = (raw) => {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const keyFor = (role, userId) => {
  const r = normalizeRole(role);
  const u = normalizeUserId(userId) || "anon";
  return `agentc:dashboard_layout:${r}:${u}`;
};

module.exports = async (req, res) => {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT");
    res.end("Method Not Allowed");
    return;
  }

  if (method === "GET") {
    const role = normalizeRole(queryValue(req, "role") || "user");
    const userId = normalizeUserId(queryValue(req, "user_id") || "");
    const key = keyFor(role, userId);
    try {
      const raw = await kvGet(key);
      const layout = parseLayout(raw);
      sendJson(res, 200, {
        ok: true,
        role,
        user_id: userId,
        layout: layout || null
      });
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        role,
        user_id: userId,
        error: String(err?.message || "KV unavailable"),
        layout: null
      });
    }
    return;
  }

  const queryRole = queryValue(req, "role");
  const queryUser = queryValue(req, "user_id");
  const body = (await readJsonBody(req)) || {};
  const role = normalizeRole(body?.role || queryRole || "user");
  const userId = normalizeUserId(body?.user_id || queryUser || "");
  const layout = body?.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    sendJson(res, 400, { ok: false, error: "layout object is required" });
    return;
  }
  if (!Array.isArray(layout.widgets)) {
    sendJson(res, 400, { ok: false, error: "layout.widgets array is required" });
    return;
  }

  const key = keyFor(role, userId);
  const storedLayout = {
    ...layout,
    role,
    version: Number.isFinite(Number(layout?.version)) ? Math.max(1, Number(layout.version)) : 1,
    updatedAt: Number.isFinite(Number(layout?.updatedAt)) && Number(layout.updatedAt) > 0 ? Number(layout.updatedAt) : Date.now()
  };
  const payload = JSON.stringify(storedLayout);
  try {
    await kvSet(key, payload);
    sendJson(res, 200, {
      ok: true,
      role,
      user_id: userId,
      updatedAt: storedLayout.updatedAt
    });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      role,
      user_id: userId,
      error: String(err?.message || "KV unavailable")
    });
  }
};
