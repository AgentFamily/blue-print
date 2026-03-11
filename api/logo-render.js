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

const clip = (value, maxChars) => {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};

const normalizeSize = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "256x256" || raw === "512x512" || raw === "1024x1024" || raw === "1536x1024" || raw === "1024x1536") {
    return raw;
  }
  return "1024x1024";
};

const normalizeQuality = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "auto") return raw;
  return "auto";
};

const normalizeBackground = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "transparent" || raw === "opaque" || raw === "auto") return raw;
  return "transparent";
};

const normalizeModel = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "gpt-image-1";
  if (/^[a-z0-9._:/-]{1,80}$/i.test(raw)) return raw;
  return "gpt-image-1";
};

const buildImagesUrl = (baseUrl) => {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/images\/generations$/i.test(base)) return base;
  if (!/\/v1$/i.test(base)) base = `${base}/v1`;
  return `${base}/images/generations`;
};

const extractUpstreamMessage = (json, rawFallback) => {
  const direct =
    json?.error?.message ||
    json?.error ||
    json?.message ||
    (typeof json === "string" ? json : "") ||
    "";
  const text = String(direct || rawFallback || "").trim();
  return text || "Upstream logo render error";
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  const prompt = String(body?.prompt || body?.brief || "").trim();
  if (!prompt) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing prompt" }));
    return;
  }

  const headerOpenKey = String(req?.headers?.["x-agentc-openai-key"] || "")
    .split(",")[0]
    .trim();
  const envOpenKey = firstEnv("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY");
  const openKey = headerOpenKey || envOpenKey;
  if (!openKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing OpenAI key. Unlock Vault or configure OPENAI_API_KEY." }));
    return;
  }

  const model = normalizeModel(body?.model || firstEnv("OPENAI_IMAGE_MODEL", "OPEN_IMAGE_MODEL") || "gpt-image-1");
  const size = normalizeSize(body?.size || firstEnv("OPENAI_IMAGE_SIZE", "OPEN_IMAGE_SIZE") || "1024x1024");
  const quality = normalizeQuality(body?.quality || firstEnv("OPENAI_IMAGE_QUALITY", "OPEN_IMAGE_QUALITY") || "auto");
  const background = normalizeBackground(body?.background || firstEnv("OPENAI_IMAGE_BACKGROUND", "OPEN_IMAGE_BACKGROUND") || "transparent");
  const temperature = Number(body?.temperature);
  const baseUrl = firstEnv("OPENAI_IMAGE_BASE_URL", "OPEN_IMAGE_BASE_URL", "OPEN_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1";
  const upstreamUrl = buildImagesUrl(baseUrl);
  const timeoutMsRaw = Number(firstEnv("OPENAI_IMAGE_TIMEOUT_MS", "OPEN_IMAGE_TIMEOUT_MS") || 90000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(10000, Math.min(180000, timeoutMsRaw)) : 90000;

  if (!upstreamUrl) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid upstream image API base URL configuration." }));
    return;
  }

  const upstreamPayload = {
    model,
    prompt: clip(prompt, 6000),
    size,
    quality,
    background,
    n: 1
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Image render request timed out")), timeoutMs);
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(upstreamPayload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await upstreamRes.text().catch(() => "");
    const json = safeJsonParse(raw);

    if (!upstreamRes.ok) {
      const message = extractUpstreamMessage(json, raw);
      res.statusCode = upstreamRes.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: `Logo render upstream failed: ${clip(message, 300)}`,
        details: json || { raw: clip(raw, 1200) }
      }));
      return;
    }

    const first = Array.isArray(json?.data) ? json.data[0] : null;
    const b64 = String(first?.b64_json || "").trim();
    const imageUrl = String(first?.url || "").trim();
    const dataUrl = b64 ? `data:image/png;base64,${b64}` : "";

    if (!imageUrl && !dataUrl) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Logo render succeeded but returned no image payload.", details: json || null }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      provider: "openai",
      model,
      size,
      quality,
      background,
      temperature: Number.isFinite(temperature) ? temperature : null,
      prompt: clip(prompt, 3000),
      revisedPrompt: String(first?.revised_prompt || ""),
      imageUrl,
      dataUrl,
      ts: Date.now()
    }));
  } catch (err) {
    const timedOut = /timed out|abort/i.test(String(err?.message || ""));
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: timedOut ? "Logo render request timed out" : "Logo render request failed",
      details: clip(err?.message || String(err), 400)
    }));
  }
};
