const firstEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const openModel = firstEnv("OPEN_MODEL", "OPENAI_MODEL") || "gpt-4o-mini";

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      models: [
        {
          name: openModel,
          model: openModel,
          size: 0,
          details: { families: [] },
        },
      ],
    })
  );
};

