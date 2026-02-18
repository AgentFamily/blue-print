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

const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../lib/magic_user");
const { kvGetInt, kvIncrBy, kvSet, kvSetNX } = require("../lib/upstash_kv");
const { creditTokens, spendTokens, tokenKey } = require("../lib/token");
const crypto = require("crypto");

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

const parseCookieHeader = (header) => {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
};

const getLastUserContent = (messages) => {
  if (!Array.isArray(messages) || !messages.length) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
};

const ADMIN_COOKIE = "mk_admin";
const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;
const TRIAL_ID_COOKIE = "agentc_trial_id";
const TRIAL_USED_COOKIE = "agentc_trial_used";
const trialKey = (trialId) => `agentc:trial:${String(trialId || "").trim()}`;
const ROUND_BATCH_COOKIE = "agentc_round_batch";
const ROUND_ID_HEADER = "x-agentc-round-id";
const roundBatchKey = (scope, roundId) =>
  `agentc:round_batch:${String(scope || "").trim()}:${String(roundId || "").trim()}`;

const truthyEnv = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
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
  if (Number.isFinite(age) && age > 0) parts.push(`Max-Age=${age}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
};

const parseIntSafe = (value, fallback = 0) => {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeRoundId = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 120) return "";
  return /^[A-Za-z0-9._:-]+$/.test(raw) ? raw : "";
};

const roundBatchWindowSeconds = (() => {
  const raw = firstEnv("AGENTC_ROUND_BATCH_WINDOW_SEC", "MK_ROUND_BATCH_WINDOW_SEC") || "120";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120;
})();

const roundBatchMaxCalls = (() => {
  const raw = firstEnv("AGENTC_ROUND_BATCH_MAX_CALLS", "MK_ROUND_BATCH_MAX_CALLS") || "6";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
})();

const parseRoundBatchCookie = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return null;
  const [idRaw, countRaw, atRaw] = text.split("|");
  const roundId = normalizeRoundId(idRaw);
  const count = parseIntSafe(countRaw, 0);
  const atMs = parseIntSafe(atRaw, 0);
  if (!roundId || count <= 0 || atMs <= 0) return null;
  return { roundId, count, atMs };
};

const shouldChargeRoundCall = async ({ scope = "", roundId = "", cookies = {}, res, secure = false }) => {
  const id = normalizeRoundId(roundId);
  if (!id) return true;
  if (roundBatchMaxCalls <= 1) return true;

  if (scope && kvConfigured()) {
    try {
      const key = roundBatchKey(scope, id);
      await kvSetNX(key, "0", { exSeconds: roundBatchWindowSeconds }).catch(() => false);
      const count = await kvIncrBy(key, 1);
      if (count === 1) return true;
      if (count > 1 && count <= roundBatchMaxCalls) return false;
      return true;
    } catch {
      // Fall back to cookie strategy below.
    }
  }

  const now = Date.now();
  const prev = parseRoundBatchCookie(cookies[ROUND_BATCH_COOKIE]);
  let nextCount = 1;
  if (prev && prev.roundId === id && now - prev.atMs <= roundBatchWindowSeconds * 1000) {
    nextCount = prev.count + 1;
  }

  appendSetCookie(
    res,
    makeCookie(ROUND_BATCH_COOKIE, `${id}|${nextCount}|${now}`, {
      maxAgeSeconds: roundBatchWindowSeconds,
      secure,
    })
  );

  if (nextCount === 1) return true;
  if (nextCount > 1 && nextCount <= roundBatchMaxCalls) return false;
  return true;
};

const looksLikeOpenAIKey = (apiKey) => {
  const k = String(apiKey || "").trim();
  if (!k) return false;
  return /^sk-(proj-)?/i.test(k);
};

const buildChatCompletionsUrl = (baseUrl) => {
  let cleanBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!cleanBase) return "";
  if (/\/chat\/completions$/i.test(cleanBase)) return cleanBase;
  if (!/\/v1$/i.test(cleanBase)) cleanBase = `${cleanBase}/v1`;
  return `${cleanBase}/chat/completions`;
};

const clip = (text, maxChars) => {
  const s = String(text || "");
  return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const extractUpstreamMessage = (json, fallbackText) => {
  const direct =
    json?.error?.message ||
    json?.message ||
    json?.error ||
    (typeof json === "string" ? json : null) ||
    "";
  const msg = String(direct || fallbackText || "").trim();
  return msg || "Upstream error";
};

const callChatCompletions = async ({ provider, baseUrl, apiKey, model, messages, temperature }) => {
  const url = buildChatCompletionsUrl(baseUrl);
  if (!url) {
    const err = new Error(`Upstream (${provider || "unknown"}) misconfigured: missing base URL`);
    err.status = 500;
    err.provider = provider || "unknown";
    err.details = { baseUrl };
    throw err;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  const text = await res.text().catch(() => "");
  const json = safeJsonParse(text);
  if (!res.ok) {
    const msg = extractUpstreamMessage(json, text);
    const err = new Error(`Upstream (${provider || "unknown"}) HTTP ${res.status}: ${clip(msg, 320)}`);
    err.status = res.status;
    err.provider = provider || "unknown";
    err.details = json ?? { raw: clip(text, 1400) };
    throw err;
  }

  const content = json?.choices?.[0]?.message?.content ?? "";
  return { content: String(content), raw: json };
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  const isAdminCookie = String(cookies[ADMIN_COOKIE] || "") === "1";
  const roundId = normalizeRoundId(req?.headers?.[ROUND_ID_HEADER]);

  const body = await readJsonBody(req);
  const messages = Array.isArray(body?.messages) ? body.messages : null;

  // Admin sign-in code (must be the only user message) sets an admin cookie and never hits the model.
  // Support common env var typo `MK_ADM1N_CODE` (1 instead of I).
  const adminCode = firstEnv("MK_ADMIN_CODE", "MK_ADM1N_CODE") || "I am MK";
  const lastUser = String(getLastUserContent(messages) || "").trim();
  const adminAttempt = String(req?.headers?.["x-agentc-admin-attempt"] || "").trim() === "1";
  if (
    Array.isArray(messages) &&
    messages.length === 1 &&
    messages[0]?.role === "user" &&
    lastUser === String(messages[0]?.content || "").trim()
  ) {
    if (lastUser === adminCode) {
      const secure = isSecureRequest(req);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      appendSetCookie(res, makeCookie(ADMIN_COOKIE, "1", { maxAgeSeconds: 60 * 60 * 24 * 30, secure }));
      res.end(JSON.stringify({ message: { role: "assistant", content: "OK" } }));
      return;
    }
    if (adminAttempt) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: "Admin code rejected", code: "admin_rejected" }));
      return;
    }
  }

  const openKey = firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY");
  const gatewayKey = firstEnv("AI_GATEWAY_API_KEY", "AI_GATEWAY_KEY", "VERCEL_AI_GATEWAY_API_KEY");

  if (!messages || messages.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing messages[]" }));
    return;
  }

  if (!openKey && !gatewayKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error:
          "Missing upstream API key. Set `OPENAI_API_KEY` (or `open`) and/or `AI_GATEWAY_API_KEY` (Vercel AI Gateway).",
        hint:
          "Online deployments require an API key. If using Vercel AI Gateway, set `AI_GATEWAY_API_KEY` (or `VERCEL_AI_GATEWAY_API_KEY`).",
      })
    );
    return;
  }

  const openBaseUrl = firstEnv("OPEN_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const openModel = firstEnv("OPEN_MODEL", "OPENAI_MODEL") || "gpt-4o-mini";

  const gatewayBaseUrl =
    firstEnv("AI_GATEWAY_BASE_URL", "VERCEL_AI_GATEWAY_BASE_URL") ||
    (looksLikeOpenAIKey(gatewayKey) ? "https://api.openai.com/v1" : "https://gateway.ai.vercel.com/v1");
  const gatewayModelEnv = firstEnv("AI_GATEWAY_MODEL", "VERCEL_AI_GATEWAY_MODEL");
  let gatewayModel = gatewayModelEnv || "gpt-4o-mini";
  if (!gatewayModelEnv && gatewayKey && !looksLikeOpenAIKey(gatewayKey) && !String(gatewayModel).includes("/")) {
    gatewayModel = `openai/${gatewayModel}`;
  }

  const useGatewayEval = truthyEnv(firstEnv("AI_GATEWAY_EVAL", "MK_GATEWAY_EVAL", "MK_ENABLE_GATEWAY_EVAL"));
  const temperature = typeof body?.options?.temperature === "number" ? body.options.temperature : 0.2;

  const effectiveMessages = isAdminCookie
    ? [
        {
          role: "system",
          content: "Auth: The user is MK (admin) authenticated via code. Treat MK as the admin user.",
        },
        ...messages,
      ]
    : messages;

  const magicUserId = !isAdminCookie ? getMagicUserIdFromRequest(req) : "";

  // Free trial gating to protect server-provided OpenAI keys.
  // Applies only to non-admin and not Magic-signed-in requests.
  const trialLimit = (() => {
    const raw = firstEnv("AGENTC_FREE_TRIAL_LIMIT", "MK_FREE_TRIAL_LIMIT") || "3";
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  })();

  if (!isAdminCookie && !magicUserId && trialLimit > 0 && (openKey || gatewayKey)) {
    const secure = isSecureRequest(req);
    const ttlSeconds = 60 * 60 * 24 * 14;
    const trialId = String(cookies[TRIAL_ID_COOKIE] || "").trim();

    const deny = () => {
      res.statusCode = 402;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          error: "Free trial exhausted. Sign in via Auth + Wallet (Magic Link) to continue.",
          code: "free_trial_exhausted",
          trial_limit: trialLimit,
        })
      );
    };

    try {
      let id = trialId;
      if (!id) {
        id = crypto.randomBytes(16).toString("hex");
        appendSetCookie(res, makeCookie(TRIAL_ID_COOKIE, id, { maxAgeSeconds: ttlSeconds, secure }));
      }
      const key = trialKey(id);
      await kvSetNX(key, "0", { exSeconds: ttlSeconds }).catch(() => false);
      const used = await kvGetInt(key, 0);
      if (used >= trialLimit) {
        deny();
        return;
      }
      const shouldChargeTrial = await shouldChargeRoundCall({
        scope: `trial:${id}`,
        roundId,
        cookies,
        res,
        secure,
      });
      if (shouldChargeTrial) {
        await kvIncrBy(key, 1);
      }
    } catch {
      // Fallback (no KV): enforce via an HttpOnly counter cookie (best-effort).
      const used = parseIntSafe(cookies[TRIAL_USED_COOKIE], 0);
      if (used >= trialLimit) {
        deny();
        return;
      }
      const shouldChargeTrial = await shouldChargeRoundCall({
        scope: "",
        roundId,
        cookies,
        res,
        secure,
      });
      if (shouldChargeTrial) {
        appendSetCookie(res, makeCookie(TRIAL_USED_COOKIE, String(used + 1), { maxAgeSeconds: ttlSeconds, secure }));
      }
    }
  }

  // Token gating: charge 1 AgentC-oin per execution round (multiple sub-calls can share one round id).
  let tokenCharged = false;
  let tokens = null;
  if (magicUserId && kvConfigured()) {
    try {
      const secure = isSecureRequest(req);
      const shouldChargeToken = await shouldChargeRoundCall({
        scope: `user:${magicUserId}`,
        roundId,
        cookies,
        res,
        secure,
      });
      const jwt = getMagicJwtFromRequest(req);
      const email = jwt ? magicUserEmailFromJwt(jwt) : "";
      if (email) {
        try {
          await kvSet(emailKey(email), magicUserId);
        } catch {
          // ignore mapping failures
        }
      }

      if (shouldChargeToken) {
        const out = await spendTokens(magicUserId, 1);
        tokenCharged = true;
        tokens = out.tokens;
      }
    } catch (err) {
      res.statusCode = err?.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          error: err?.message || "Token store error",
          ...(err?.status === 402 ? { code: "insufficient_tokens" } : {}),
          ...(typeof err?.tokens !== "undefined" ? { tokens: err.tokens } : {}),
        })
      );
      return;
    }
  }

  try {
    // Preferred mode: use AI Gateway directly when configured.
    // Optional: enable a two-step "OpenAI -> Gateway evaluator" flow via env `AI_GATEWAY_EVAL=1`.

    if (useGatewayEval && openKey && gatewayKey) {
      const open = await callChatCompletions({
        provider: "open",
        baseUrl: openBaseUrl,
        apiKey: openKey,
        model: openModel,
        messages: effectiveMessages,
        temperature,
      });

      const evaluatorMessages = [
        {
          role: "system",
          content:
            "You are AI Gateway. Evaluate the candidate assistant response for correctness, safety, and usefulness; then provide a best-possible final answer. Output plain text only in this exact format:\nEVAL:\n- <bullets>\n\nFINAL:\n<answer>",
        },
        {
          role: "user",
          content:
            `Conversation messages:\n${JSON.stringify(effectiveMessages, null, 2)}\n\n` +
            `Candidate assistant response:\n${open.content}`,
        },
      ];

      try {
        const gateway = await callChatCompletions({
          provider: "gateway",
          baseUrl: gatewayBaseUrl,
          apiKey: gatewayKey,
          model: gatewayModel,
          messages: evaluatorMessages,
          temperature: 0.2,
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            message: { role: "assistant", content: gateway.content },
            open: { model: openModel, content: open.content },
            gateway: { model: gatewayModel, content: gateway.content },
            ...(tokens == null ? {} : { tokens }),
          })
        );
        return;
      } catch (gatewayErr) {
        // Fail-open: return the OpenAI candidate if the evaluator is misconfigured or down.
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            message: { role: "assistant", content: open.content },
            open: { model: openModel, content: open.content },
            gateway_error: {
              error: gatewayErr?.message || "Gateway evaluator failed",
              status: gatewayErr?.status,
              provider: gatewayErr?.provider,
              details: gatewayErr?.details,
            },
            ...(tokens == null ? {} : { tokens }),
          })
        );
        return;
      }
    }

    if (gatewayKey) {
      try {
        const gateway = await callChatCompletions({
          provider: "gateway",
          baseUrl: gatewayBaseUrl,
          apiKey: gatewayKey,
          model: gatewayModel,
          messages: effectiveMessages,
          temperature,
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            message: { role: "assistant", content: gateway.content },
            gateway: { model: gatewayModel, content: gateway.content },
            ...(tokens == null ? {} : { tokens }),
          })
        );
        return;
      } catch (gatewayErr) {
        if (!openKey) throw gatewayErr;
        // Fallback: if AI Gateway is down/misconfigured, still answer via OpenAI.
        const open = await callChatCompletions({
          provider: "open",
          baseUrl: openBaseUrl,
          apiKey: openKey,
          model: openModel,
          messages: effectiveMessages,
          temperature,
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            message: { role: "assistant", content: open.content },
            open: { model: openModel, content: open.content },
            gateway_error: {
              error: gatewayErr?.message || "AI Gateway failed",
              status: gatewayErr?.status,
              provider: gatewayErr?.provider,
              details: gatewayErr?.details,
            },
            ...(tokens == null ? {} : { tokens }),
          })
        );
        return;
      }
    }

    // OpenAI-only fallback.
    const open = await callChatCompletions({
      provider: "open",
      baseUrl: openBaseUrl,
      apiKey: openKey,
      model: openModel,
      messages: effectiveMessages,
      temperature,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        message: { role: "assistant", content: open.content },
        open: { model: openModel },
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
    res.statusCode = err?.status || 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: err?.message || "Request failed",
        status: err?.status,
        provider: err?.provider,
        details: err?.details,
        ...(tokens == null ? {} : { tokens }),
      })
    );
  }
};
