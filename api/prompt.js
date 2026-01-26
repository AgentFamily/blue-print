module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const openKey =
    process.env.open ||
    process.env.OPEN ||
    process.env.OPENAI_API_KEY ||
    process.env.OPEN_AI_API_KEY ||
    process.env.OPEN_API_KEY;
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;

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

  const openBaseUrl = String(process.env.OPEN_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/+$/,
    ""
  );
  const gatewayBaseUrl = String(process.env.AI_GATEWAY_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  const openModel = process.env.OPEN_MODEL || process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  const gatewayModel = process.env.AI_GATEWAY_MODEL || process.env.AI_MODEL || "gpt-4o-mini";

  try {
    const openRes = await fetch(`${openBaseUrl}/chat/completions`, {
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
              "You are a concise assistant. Return a short, direct answer with no markdown unless asked.",
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

    const gatewayRes = await fetch(`${gatewayBaseUrl}/chat/completions`, {
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
      res.statusCode = gatewayRes.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "AI Gateway upstream error",
          details: gatewayData,
        })
      );
      return;
    }

    const evalText = String(gatewayData?.choices?.[0]?.message?.content ?? "");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: evalText, open_text: openText }));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Request failed",
        details: err?.message || String(err),
      })
    );
  }
};
