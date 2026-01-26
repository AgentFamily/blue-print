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

const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const callChatCompletions = async ({ baseUrl, apiKey, model, messages, temperature }) => {
  const cleanBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  const url = `${cleanBase}/chat/completions`;

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

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error("Upstream error");
    err.status = res.status;
    err.details = json;
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

  const openKey = firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY");
  const gatewayKey = firstEnv("AI_GATEWAY_API_KEY");

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

  const body = await readJsonBody(req);
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing messages[]" }));
    return;
  }

  const openBaseUrl = firstEnv("OPEN_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const openModel = firstEnv("OPEN_MODEL", "OPENAI_MODEL") || "gpt-4o-mini";
  const gatewayBaseUrl = firstEnv("AI_GATEWAY_BASE_URL") || "https://api.openai.com/v1";
  const gatewayModel = firstEnv("AI_GATEWAY_MODEL") || "gpt-4o-mini";
  const temperature = typeof body?.options?.temperature === "number" ? body.options.temperature : 0.2;

  try {
    const open = await callChatCompletions({
      baseUrl: openBaseUrl,
      apiKey: openKey,
      model: openModel,
      messages,
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
          `Conversation messages:\n${JSON.stringify(messages, null, 2)}\n\n` +
          `Candidate assistant response:\n${open.content}`,
      },
    ];

    const gateway = await callChatCompletions({
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
      })
    );
  } catch (err) {
    res.statusCode = err?.status || 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: err?.message || "Request failed",
        details: err?.details,
      })
    );
  }
};

