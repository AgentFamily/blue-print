const { getDefinition, getRun, saveRun, saveNodeRun } = require("./pipelines");

// node handlers are defined in their own module for easier extension
const handlers = require("./handlers");

const MAX_ATTEMPTS = 3;

async function dispatchNext(runId) {
  const run = await getRun(runId);
  if (!run || run.status !== "running") return;
  const def = await getDefinition(run.pipelineId);
  if (!def) {
    run.status = "error";
    run.lastError = `definition ${run.pipelineId} not found`;
    run.endedAt = Date.now();
    await saveRun(run);
    return;
  }

  const current = run.currentNode;
  if (!current) {
    run.status = "success";
    run.endedAt = Date.now();
    await saveRun(run);
    return;
  }

  const node = def.nodes.find((n) => n.id === current);
  if (!node) {
    run.status = "error";
    run.lastError = `node ${current} missing in definition`;
    run.endedAt = Date.now();
    await saveRun(run);
    return;
  }

  // check connection requirements before executing
  if (node.requires && Array.isArray(node.requires) && node.requires.length) {
    const { checkConnections } = require("./validators");
    const missing = await checkConnections(node.requires);
    if (missing.length) {
      run.status = "error";
      run.lastError = `missing connections: ${missing.join(",")}`;
      await saveRun(run);
      return;
    }
  }

  let nodeRun = await getNodeRun(runId, current);
  if (!nodeRun) {
    nodeRun = {
      nodeId: current,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      attempts: 1,
      logs: [],
      output: null,
      error: null,
    };
  } else if (nodeRun.status === "error" && nodeRun.attempts < MAX_ATTEMPTS) {
    nodeRun.attempts += 1;
    nodeRun.status = "running";
    nodeRun.error = null;
    nodeRun.logs = [];
    nodeRun.startedAt = Date.now();
    nodeRun.endedAt = null;
  } else {
    // nothing to do
    return;
  }

  await saveNodeRun(runId, nodeRun);

  try {
    const fn = handlers[node.type];
    if (!fn) throw new Error(`no handler for node type ${node.type}`);
    const result = await fn({ run, node });
    nodeRun.status = "success";
    nodeRun.endedAt = Date.now();
    nodeRun.output = result || {};
    await saveNodeRun(runId, nodeRun);

    // advance to next node (take first next for now)
    const next = Array.isArray(node.next) && node.next.length ? node.next[0] : null;
    run.currentNode = next;
    await saveRun(run);
    // recurse
    await dispatchNext(runId);
  } catch (err) {
    nodeRun.status = "error";
    nodeRun.endedAt = Date.now();
    nodeRun.error = String(err.message || err);
    nodeRun.logs.push({ t: Date.now(), msg: nodeRun.error });
    await saveNodeRun(runId, nodeRun);

    run.status = "error";
    run.lastError = nodeRun.error;
    await saveRun(run);
  }
}

module.exports = {
  dispatchNext,
};
