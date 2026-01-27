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

const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("./_lib/magic_user");
const { kvIncrBy, kvSet, kvSetNX } = require("./_lib/upstash_kv");

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
const tokenKey = (userId) => `agentc:tokens:${userId}`;
const emailKey = (email) => `agentc:email_to_user:${String(email || "").trim().toLowerCase()}`;
const INITIAL_TOKENS = 77;

const truthyEnv = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
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

  const body = await readJsonBody(req);
  const messages = Array.isArray(body?.messages) ? body.messages : null;

  // Admin sign-in code: "I am MK" (must be the only user message) sets an admin cookie and never hits the model.
  const adminCode = firstEnv("MK_ADMIN_CODE") || "I am MK";
  const lastUser = String(getLastUserContent(messages) || "").trim();
  if (
    Array.isArray(messages) &&
    messages.length === 1 &&
    messages[0]?.role === "user" &&
    String(messages[0]?.content || "").trim() === adminCode &&
    lastUser === adminCode
  ) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Set-Cookie",
      `${ADMIN_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax; Secure`
    );
    res.end(JSON.stringify({ message: { role: "assistant", content: "OK" } }));
    return;
  }

  const openKey = firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY");
  const gatewayKey = firstEnv("AI_GATEWAY_API_KEY");

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
        error: "Missing upstream API key (expected `open`/`OPENAI_API_KEY` and/or `AI_GATEWAY_API_KEY`)",
      })
    );
    return;
  }

  const openBaseUrl = firstEnv("OPEN_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const openModel = firstEnv("OPEN_MODEL", "OPENAI_MODEL") || "gpt-4o-mini";

  const gatewayBaseUrl =
    firstEnv("AI_GATEWAY_BASE_URL") ||
    (looksLikeOpenAIKey(gatewayKey) ? "https://api.openai.com/v1" : "https://gateway.ai.vercel.com/v1");
  const gatewayModelEnv = firstEnv("AI_GATEWAY_MODEL");
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

  // Token gating: charge 1 AgentC-oin per /api/chat call for Magic-signed-in users.
  const magicUserId = !isAdminCookie ? getMagicUserIdFromRequest(req) : "";
  let tokenCharged = false;
  let tokens = null;
  if (magicUserId) {
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

      try {
        await kvSetNX(tokenKey(magicUserId), String(INITIAL_TOKENS));
      } catch {
        // ignore init failures
      }

      const next = await kvIncrBy(tokenKey(magicUserId), -1);
      if (next < 0) {
        await kvIncrBy(tokenKey(magicUserId), 1);
        res.statusCode = 402;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: "No AgentC-oins remaining.", tokens: 0 }));
        return;
      }
      tokenCharged = true;
      tokens = next;
    } catch (err) {
      res.statusCode = err?.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: err?.message || "Token store error" }));
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
        await kvIncrBy(tokenKey(magicUserId), 1);
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
