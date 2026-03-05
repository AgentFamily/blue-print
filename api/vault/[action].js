const { getSecret, setSecret, listSecrets, deleteSecret } = require("../../lib/vault");
const { requireVaultPassword } = require("../../lib/vault_auth");
const {
  unlockVault,
  lockVault,
  issueSessionToken,
  getStatus: vaultBrokerStatus,
  listAudit: vaultBrokerAudit,
  permissionForSecret,
} = require("../../lib/vault_broker");

const getAction = (req) => {
  const raw = req?.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || "").trim().toLowerCase();
  return String(raw || "").trim().toLowerCase();
};

const readInt = (value, fallback) => {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

const boolish = (value, fallback = false) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return Boolean(fallback);
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on" || raw === "y";
};

const isSecureRequest = (req) => {
  try {
    const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
    if (proto) return proto.includes("https");
  } catch {
    // ignore
  }
  return false;
};

const appendSetCookie = (res, cookie) => {
  const value = String(cookie || "").trim();
  if (!value) return;
  try {
    const prev = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : null;
    if (!prev) {
      res.setHeader("Set-Cookie", value);
      return;
    }
    if (Array.isArray(prev)) {
      res.setHeader("Set-Cookie", [...prev, value]);
      return;
    }
    res.setHeader("Set-Cookie", [prev, value]);
  } catch {
    res.setHeader("Set-Cookie", value);
  }
};

const makeCookie = (name, value, { maxAgeSeconds, httpOnly = true, sameSite = "Lax", secure = false } = {}) => {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ""))}`, "Path=/"];
  const age = parseInt(String(maxAgeSeconds ?? ""), 10);
  if (Number.isFinite(age) && age >= 0) parts.push(`Max-Age=${age}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
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
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

module.exports = async (req, res) => {
  try {
    const action = getAction(req);
    const body = await readJsonBody(req);
    const actorId = String(req?.headers?.["x-agentc-actor-id"] || body?.actorId || "vault-ui").trim() || "vault-ui";
    const botId = String(req?.headers?.["x-agentc-bot-id"] || body?.botId || "chat-assistant").trim() || "chat-assistant";

    if (!requireVaultPassword(req, res)) return;

    if (action === "unlock") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      await unlockVault({ actorType: "human", actorId });
      const ttlMs = readInt(body?.ttlMs, 10 * 60 * 1000);
      const oneTime = boolish(body?.oneTime, false);
      const permissions = Array.isArray(body?.permissions) && body.permissions.length
        ? body.permissions
        : [permissionForSecret("OPENAI_API_KEY")];
      const session = await issueSessionToken({
        actorType: "human",
        actorId,
        botId,
        ttlMs,
        permissions,
        oneTime,
      });

      const secure = isSecureRequest(req);
      appendSetCookie(
        res,
        makeCookie("agentc_vault_session", session.sessionToken, {
          maxAgeSeconds: Math.max(1, Math.ceil(Number(session.ttlMs || 0) / 1000)),
          secure,
        })
      );

      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: true,
          unlocked: true,
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
          ttlMs: session.ttlMs,
          oneTime: session.oneTime,
          permissions: session.permissions,
          botId: session.botId,
        })
      );
    }

    if (action === "lock") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      await lockVault({ actorType: "human", actorId, reason: String(body?.reason || "manual").trim() || "manual", botId });
      const secure = isSecureRequest(req);
      appendSetCookie(
        res,
        makeCookie("agentc_vault_session", "", {
          maxAgeSeconds: 0,
          secure,
        })
      );
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, unlocked: false }));
    }

    if (action === "issue-session" || action === "issue_session") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      const ttlMs = readInt(body?.ttlMs, 10 * 60 * 1000);
      const oneTime = boolish(body?.oneTime, false);
      const permissions = Array.isArray(body?.permissions) && body.permissions.length
        ? body.permissions
        : [permissionForSecret("OPENAI_API_KEY")];
      const session = await issueSessionToken({
        actorType: "human",
        actorId,
        botId,
        ttlMs,
        permissions,
        oneTime,
      });
      const secure = isSecureRequest(req);
      appendSetCookie(
        res,
        makeCookie("agentc_vault_session", session.sessionToken, {
          maxAgeSeconds: Math.max(1, Math.ceil(Number(session.ttlMs || 0) / 1000)),
          secure,
        })
      );
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: true,
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
          ttlMs: session.ttlMs,
          oneTime: session.oneTime,
          permissions: session.permissions,
          botId: session.botId,
        })
      );
    }

    if (action === "broker-status" || action === "broker_status" || action === "status") {
      if (req.method !== "GET" && req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        return res.end("Method Not Allowed");
      }
      const status = await vaultBrokerStatus();
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, ...status }));
    }

    if (action === "audit") {
      if (req.method !== "GET" && req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        return res.end("Method Not Allowed");
      }
      const limit = readInt(req?.query?.limit ?? body?.limit, 50);
      const events = await vaultBrokerAudit({ limit });
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, events }));
    }

    if (action === "get") {
      if (req.method !== "GET" && req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        return res.end("Method Not Allowed");
      }
      const name = String(req.query?.name || body?.name || "");
      if (!name) {
        res.statusCode = 400;
        return res.end("name required");
      }
      const value = await getSecret(name);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ value }));
    }

    if (action === "set") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      const { name, value } = body || {};
      if (!name || typeof value === "undefined") {
        res.statusCode = 400;
        return res.end("name and value required");
      }
      await setSecret(name, value);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }

    if (action === "list") {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        return res.end("Method Not Allowed");
      }
      const names = await listSecrets();
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(names));
    }

    if (action === "delete") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "POST");
        return res.end("POST only");
      }
      const { name } = body || {};
      if (!name) {
        res.statusCode = 400;
        return res.end("name required");
      }
      await deleteSecret(name);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }

    res.statusCode = 404;
    res.end(`Unknown vault action: ${action || "none"}`);
  } catch (err) {
    res.statusCode = err?.status || 500;
    res.end(err?.message || String(err));
  }
};
