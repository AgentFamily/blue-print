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

const { pipelines } = require("../_lib");
const { getRun, saveRun } = pipelines;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !body.runId) {
    res.statusCode = 400;
    res.end("runId required");
    return;
  }

  try {
    const run = await getRun(body.runId);
    if (!run) {
      res.statusCode = 404;
      res.end("run not found");
      return;
    }
    if (run.status === "running") {
      run.status = "canceled";
      run.endedAt = Date.now();
      await saveRun(run);
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(run));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};