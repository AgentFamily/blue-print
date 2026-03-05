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

const { pipelines, pipelineEngine, validators } = require("../_lib");
const { createRun, getRun, saveRun } = pipelines;
const { dispatchNext } = pipelineEngine;

module.exports = async (req, res) => {
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body || !body.pipelineId) {
      res.statusCode = 400;
      res.end("pipelineId required");
      return;
    }
    try {
      // pre‑flight: ensure required connected accounts are available
      const def = await pipelines.getDefinition(body.pipelineId);
      if (def && def.nodes) {
        const { checkConnections } = validators;
        // gather all required providers across nodes
        const allReq = [];
        for (const node of def.nodes) {
          if (node.requires && Array.isArray(node.requires)) {
            allReq.push(...node.requires);
          }
        }
        const missing = await validators.checkConnections(allReq);
        if (missing.length) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "missing connections", missing: [...new Set(missing)] }));
          return;
        }
      }

      const run = await createRun(body.pipelineId, body.input || {});
      // start execution asynchronously but don't wait
      dispatchNext(run.runId).catch((e) => {
        console.error("dispatch error", e);
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(run));
    } catch (err) {
      res.statusCode = err.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err.message) }));
    }
    return;
  }

  if (req.method === "GET") {
    const runId = req.query && req.query.runId;
    if (!runId) {
      res.statusCode = 400;
      res.end("runId query param required");
      return;
    }
    try {
      const run = await getRun(runId);
      if (!run) {
        res.statusCode = 404;
        res.end("run not found");
        return;
      }
      // gather node runs? you can fetch later by separate endpoint
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(run));
    } catch (err) {
      res.statusCode = err.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err.message) }));
    }
    return;
  }

  res.statusCode = 405;
  res.setHeader("Allow", "POST, GET");
  res.end("Method Not Allowed");
};