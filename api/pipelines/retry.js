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

const { pipelines, pipelineEngine } = require("../_lib");
const { getRun, saveRun, getNodeRun } = pipelines;
const { dispatchNext } = pipelineEngine;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !body.runId || !body.nodeId) {
    res.statusCode = 400;
    res.end("runId and nodeId required");
    return;
  }

  try {
    const run = await getRun(body.runId);
    if (!run) {
      res.statusCode = 404;
      res.end("run not found");
      return;
    }
    // only allow retry if last error
    const nodeRun = await getNodeRun(body.runId, body.nodeId);
    if (!nodeRun || nodeRun.status !== "error") {
      res.statusCode = 400;
      res.end("node not in errored state");
      return;
    }

    // reset run to point to this node again
    run.currentNode = body.nodeId;
    run.status = "running";
    run.lastError = null;
    await saveRun(run);

    // kick off dispatch; engine will pick up node attempts
    dispatchNext(run.runId).catch((e) => console.error(e));

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(run));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};