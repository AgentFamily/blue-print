const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../../lib/magic_user");
const { kvSet } = require("../../lib/upstash_kv");
const { creditTokens, spendTokens } = require("../../lib/token");
const { getSecret: vaultBrokerGetSecret, extractSessionTokenFromRequest } = require("../../lib/vault_broker");

const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const kvConfigured = () => {
  const url = firstEnv("KV_REST_API_URL", "KV_RESTAPI_URL", "UPSTASH_REDIS_REST_URL");
  const token = firstEnv("KV_REST_API_TOKEN", "KV_RESTAPI_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
  return Boolean(url && token);
};

const normalizeHeaderToken = (raw) => {
  let value = String(raw || "").trim();
  if (!value) return "";
  if (value.includes(",")) value = value.split(",")[0].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/^bearer\s+/i, "").trim();
};

const normalizeOpenAIKey = (raw) => {
  const value = normalizeHeaderToken(raw);
  if (!value) return "";
  const match = value.match(/sk-(?:proj-)?[a-z0-9._-]+/i);
  if (match && match[0]) return String(match[0]).trim();
  return value;
};

const parseBody = (req) => {
  if (req?.body && typeof req.body === "object") return req.body;
  if (typeof req?.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
};

const clampInt = (value, min, max, fallback) => {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeImageSize = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  const allowed = new Set(["1024x1024", "1536x1024", "1024x1536"]);
  return allowed.has(raw) ? raw : "1536x1024";
};

const buildImagesUrl = (baseUrl) => {
  let cleanBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!cleanBase) return "";
  if (/\/images\/generations$/i.test(cleanBase)) return cleanBase;
  if (!/\/v1$/i.test(cleanBase)) cleanBase = `${cleanBase}/v1`;
  return `${cleanBase}/images/generations`;
};

const extractGeneratedImages = (payload) => {
  const out = [];
  const data = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of data) {
    const row = {};
    const url = String(item?.url || "").trim();
    const b64 = String(item?.b64_json || "").trim();
    const revised = String(item?.revised_prompt || "").trim();
    if (url) row.url = url;
    if (b64) row.data_url = `data:image/png;base64,${b64}`;
    if (revised) row.revised_prompt = revised;
    if (Object.keys(row).length) out.push(row);
  }
  return out;
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const botIdForBroker = String(req?.headers?.["x-agentc-bot-id"] || "image-generator").trim() || "image-generator";
  const headerOpenKey = normalizeOpenAIKey(req?.headers?.["x-agentc-openai-key"]);
  const vaultSessionToken = extractSessionTokenFromRequest(req);
  let brokerOpenKey = "";
  let brokerOpenKeyError = null;
  if (!headerOpenKey && vaultSessionToken) {
    try {
      brokerOpenKey = normalizeOpenAIKey(
        await vaultBrokerGetSecret("OPENAI_API_KEY", vaultSessionToken, {
          botId: botIdForBroker,
        })
      );
    } catch (err) {
      brokerOpenKeyError = err;
    }
  }
  const openKey =
    headerOpenKey ||
    brokerOpenKey ||
    normalizeOpenAIKey(
      firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY")
    );

  if (!openKey) {
    if (vaultSessionToken && brokerOpenKeyError) {
      res.statusCode = brokerOpenKeyError?.status || 401;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: brokerOpenKeyError?.message || "Vault Broker session rejected.",
          status: brokerOpenKeyError?.status,
          details: brokerOpenKeyError?.details,
        })
      );
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing OpenAI key env/header (open or OPENAI_API_KEY)." }));
    return;
  }

  const body = parseBody(req) || {};
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing prompt" }));
    return;
  }

  const model = String(body?.model || firstEnv("OPEN_IMAGE_MODEL") || "gpt-image-1").trim() || "gpt-image-1";
  const size = normalizeImageSize(body?.size);
  const quality = "high";
  const n = clampInt(body?.n, 1, 4, 1);
  const timeoutMs = clampInt(firstEnv("OPEN_TIMEOUT_MS", "OPEN_TIMEOUT_S"), 10, 120, 45) * 1000;

  const magicUserId = getMagicUserIdFromRequest(req);
  let tokenCharged = false;
  let tokens = null;
  if (magicUserId && kvConfigured()) {
    try {
      const jwt = getMagicJwtFromRequest(req);
      const email = jwt ? magicUserEmailFromJwt(jwt) : "";
      if (email) {
        try {
          await kvSet(emailKey(email), magicUserId);
        } catch {
          // ignore mapping failures
        }
      }

      const out = await spendTokens(magicUserId, 1);
      tokenCharged = true;
      tokens = out.tokens;
    } catch (err) {
      res.statusCode = err?.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: err?.message || "Token store error",
          ...(typeof err?.tokens !== "undefined" ? { tokens: err.tokens } : {}),
        })
      );
      return;
    }
  }

  const finalPrompt = [
    "Generate a high-quality image that stays faithful to the user's idea and supports strong, consistent brand identity.",
    prompt
  ].filter(Boolean).join("\n");

  const baseUrl = String(firstEnv("OPEN_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
  const upstreamUrl = buildImagesUrl(baseUrl);

  try {
    const timeoutSignal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: finalPrompt,
        size,
        quality,
        n,
      }),
      ...(timeoutSignal ? { signal: timeoutSignal } : {}),
    });

    const upstreamData = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok) {
      res.statusCode = upstreamRes.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "OpenAI image upstream error",
          details: upstreamData,
          ...(tokens == null ? {} : { tokens }),
        })
      );
      return;
    }

    const images = extractGeneratedImages(upstreamData);
    if (!images.length) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Image upstream returned no images.",
          details: upstreamData,
          ...(tokens == null ? {} : { tokens }),
        })
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        model,
        images,
        ...(tokens == null ? {} : { tokens }),
      })
    );
  } catch (err) {
    if (tokenCharged && magicUserId) {
      try {
        await creditTokens(magicUserId, 1, { reason: "upstream_error_refund" });
      } catch {
        // ignore refund failures
      }
    }
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Request failed",
        details: err?.message || String(err),
        ...(tokens == null ? {} : { tokens }),
      })
    );
  }
};
