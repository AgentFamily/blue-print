const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../lib/magic_user");
const { kvSet } = require("../lib/upstash_kv");
const { creditTokens, spendTokens } = require("../lib/token");
const { getSecret: vaultBrokerGetSecret, extractSessionTokenFromRequest } = require("../lib/vault_broker");

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

const looksLikeOpenAIKey = (apiKey) => {
  const k = normalizeOpenAIKey(apiKey);
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

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
};

const clip = (text, maxChars) => {
  const s = String(text || "");
  return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
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

  const botIdForBroker = String(req?.headers?.["x-agentc-bot-id"] || "chat-assistant").trim() || "chat-assistant";
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
  const envOpenKey = normalizeOpenAIKey(
    firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY")
  );
  const openKey = headerOpenKey || brokerOpenKey || envOpenKey;
  const gatewayKey = normalizeHeaderToken(
    req?.headers?.["x-agentc-gateway-key"] || firstEnv("AI_GATEWAY_API_KEY", "AI_GATEWAY_KEY", "VERCEL_AI_GATEWAY_API_KEY")
  );

  if (!openKey && !gatewayKey) {
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
    res.end(
      JSON.stringify({
        error:
          "Missing upstream API key. Provide `X-AgentC-OpenAI-Key` from Vault, or set `OPENAI_API_KEY`/`open`, and/or `AI_GATEWAY_API_KEY`.",
      })
    );
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  const prompt = body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing prompt" }));
    return;
  }

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
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          error: err?.message || "Token store error",
          ...(typeof err?.tokens !== "undefined" ? { tokens: err.tokens } : {}),
        })
      );
      return;
    }
  }

  const requestedModel = String(body?.model || body?.open_model || "").trim();
  const openBaseUrl = String(process.env.OPEN_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/+$/,
    ""
  );
  const gatewayBaseUrl = String(
    process.env.AI_GATEWAY_BASE_URL ||
      (looksLikeOpenAIKey(gatewayKey) ? "https://api.openai.com/v1" : "https://gateway.ai.vercel.com/v1")
  ).replace(/\/+$/, "");

  const openModel = requestedModel || process.env.OPEN_MODEL || process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  const gatewayModelEnv = process.env.AI_GATEWAY_MODEL;
  let gatewayModel = requestedModel || gatewayModelEnv || process.env.AI_MODEL || "gpt-4o-mini";
  if (!requestedModel && !gatewayModelEnv && !looksLikeOpenAIKey(gatewayKey) && !String(gatewayModel).includes("/")) {
    gatewayModel = `openai/${gatewayModel}`;
  }

  const promptMessages = [
    {
      role: "system",
      content:
        "You are a concise assistant. Return a short, direct answer with no markdown unless asked.",
    },
    { role: "user", content: prompt.trim() },
  ];

  try {
    let openResult = null;
    let openErr = null;
    if (openKey) {
      try {
        openResult = await callChatCompletions({
          provider: "open",
          baseUrl: openBaseUrl,
          apiKey: openKey,
          model: openModel,
          messages: promptMessages,
          temperature: 0.2,
        });
      } catch (err) {
        openErr = err;
      }
    }

    if (openResult) {
      const openText = String(openResult.content || "");
      if (!gatewayKey) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: openText, open_text: openText, ...(tokens == null ? {} : { tokens }) }));
        return;
      }

      const evaluatorMessages = [
        {
          role: "system",
          content:
            "You are AI Gateway. Evaluate the candidate assistant response for correctness, safety, and usefulness; then provide a best-possible final answer. Output plain text only in this exact format:\nEVAL:\n- <bullets>\n\nFINAL:\n<answer>",
        },
        {
          role: "user",
          content: `User prompt:\n${prompt}\n\nCandidate assistant response:\n${openText}`,
        },
      ];

      try {
        const gatewayEval = await callChatCompletions({
          provider: "gateway",
          baseUrl: gatewayBaseUrl,
          apiKey: gatewayKey,
          model: gatewayModel,
          messages: evaluatorMessages,
          temperature: 0.2,
        });
        const evalText = String(gatewayEval.content || "");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: evalText, open_text: openText, ...(tokens == null ? {} : { tokens }) }));
        return;
      } catch (gatewayErr) {
        // Fail-open: return the OpenAI candidate if evaluator is unavailable.
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            text: openText,
            open_text: openText,
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
      const gatewayResult = await callChatCompletions({
        provider: "gateway",
        baseUrl: gatewayBaseUrl,
        apiKey: gatewayKey,
        model: gatewayModel,
        messages: promptMessages,
        temperature: 0.2,
      });
      const gatewayText = String(gatewayResult.content || "");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: gatewayText,
          gateway_text: gatewayText,
          ...(openErr
            ? {
                open_error: {
                  error: openErr?.message || "OpenAI failed",
                  status: openErr?.status,
                  provider: openErr?.provider,
                  details: openErr?.details,
                },
              }
            : {}),
          ...(tokens == null ? {} : { tokens }),
        })
      );
      return;
    }

    throw openErr || new Error("No upstream provider available");
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
        details: err?.details ?? err?.message ?? String(err),
        ...(tokens == null ? {} : { tokens }),
      })
    );
  }
};
