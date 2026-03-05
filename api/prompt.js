const { getMagicJwtFromRequest, magicUserEmailFromJwt, getMagicUserIdFromRequest } = require("../lib/magic_user");
const { kvSet } = require("../lib/upstash_kv");
const { creditTokens, spendTokens } = require("../lib/token");

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const openKey = firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY");
  const gatewayKey = firstEnv("AI_GATEWAY_API_KEY", "AI_GATEWAY_KEY");

  if (!openKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing OpenAI key env (expected `open` or `OPENAI_API_KEY`)" }));
    return;
  }
  if (!gatewayKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing AI_GATEWAY_API_KEY" }));
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

  const openBaseUrl = String(process.env.OPEN_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/+$/,
    ""
  );
  const gatewayBaseUrl = String(
    process.env.AI_GATEWAY_BASE_URL ||
      (looksLikeOpenAIKey(gatewayKey) ? "https://api.openai.com/v1" : "https://gateway.ai.vercel.com/v1")
  ).replace(/\/+$/, "");

  const openModel = process.env.OPEN_MODEL || process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  const gatewayModelEnv = process.env.AI_GATEWAY_MODEL;
  let gatewayModel = gatewayModelEnv || process.env.AI_MODEL || "gpt-4o-mini";
  if (!gatewayModelEnv && !looksLikeOpenAIKey(gatewayKey) && !String(gatewayModel).includes("/")) {
    gatewayModel = `openai/${gatewayModel}`;
  }

  try {
    const openRes = await fetch(buildChatCompletionsUrl(openBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(openKey).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openModel,
        messages: [
          {
            role: "system",
            content:
              "You are the Agent Family ensemble. Reply as a short multi-character exchange inspired by the Agent Family visuals (neutral, angry, sad, and glitch variants). " +
              "Use 2-4 short turns. Format each line as 'Agent Neutral:', 'Agent Angry:', 'Agent Sad:', 'Agent Neutral Glitch:', 'Agent Angry Glitch:', or 'Agent Sad Glitch:'. " +
              "Keep the tone cinematic, smart, and helpful. Prioritize accuracy and clarity. Plain text only, no markdown unless asked.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const openData = await openRes.json().catch(() => null);
    if (!openRes.ok) {
      res.statusCode = openRes.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "OpenAI upstream error",
          details: openData,
        })
      );
      return;
    }

    const openText = String(openData?.choices?.[0]?.message?.content ?? "");

    const gatewayRes = await fetch(buildChatCompletionsUrl(gatewayBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(gatewayKey).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: gatewayModel,
        messages: [
          {
            role: "system",
            content:
              "You are AI Gateway. Evaluate the candidate assistant response for correctness, safety, and usefulness; then provide a best-possible final answer. Output plain text only in this exact format:\nEVAL:\n- <bullets>\n\nFINAL:\n<answer>",
          },
          {
            role: "user",
            content: `User prompt:\n${prompt}\n\nCandidate assistant response:\n${openText}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    const gatewayData = await gatewayRes.json().catch(() => null);
    if (!gatewayRes.ok) {
      // Fail-open: return the OpenAI candidate if the evaluator is misconfigured or down.
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: openText,
          open_text: openText,
          gateway_error: {
            status: gatewayRes.status || 502,
            details: gatewayData,
          },
          ...(tokens == null ? {} : { tokens }),
        })
      );
      return;
    }

    const evalText = String(gatewayData?.choices?.[0]?.message?.content ?? "");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: evalText, open_text: openText, ...(tokens == null ? {} : { tokens }) }));
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
