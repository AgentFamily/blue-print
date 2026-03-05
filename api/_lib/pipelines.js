const { kvGet, kvSet } = require("./upstash_kv");
const crypto = require("crypto");

// definitions list key for convenience
const DEF_ALL_KEY = "pipe:def:all";
const DEF_KEY = (id) => `pipe:def:${String(id)}`;
const RUN_KEY = (runId) => `pipe:run:${String(runId)}`;
const NODE_KEY = (runId, nodeId) => `pipe:run:${String(runId)}:node:${String(nodeId)}`;
// list of recent runs
const RUN_ALL_KEY = "pipe:run:all";
const MAX_RUNS = 100;

async function listDefinitions() {
  const raw = await kvGet(DEF_ALL_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

async function getDefinition(pipelineId) {
  if (!pipelineId) return null;
  const raw = await kvGet(DEF_KEY(pipelineId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveDefinition(def) {
  if (!def || !def.id) {
    throw new Error("pipeline definition must have id");
  }
  const key = DEF_KEY(def.id);
  await kvSet(key, JSON.stringify(def));

  const list = await listDefinitions();
  if (!list.includes(def.id)) {
    list.push(def.id);
    await kvSet(DEF_ALL_KEY, JSON.stringify(list));
  }
  return def;
}

async function _generateRunId() {
  return `run_${crypto.randomBytes(6).toString("hex")}`;
}

async function createRun(pipelineId, input = {}) {
  const def = await getDefinition(pipelineId);
  if (!def) throw new Error(`pipeline definition not found: ${pipelineId}`);
  const runId = await _generateRunId();
  const now = Date.now();
  const run = {
    runId,
    pipelineId,
    startedAt: now,
    endedAt: null,
    status: "running",
    input,
    currentNode: def.nodes && def.nodes.length ? def.nodes[0].id : null,
    cost: { tokens: 0, usd: 0 },
    artifacts: [],
    lastError: null,
  };
  await kvSet(RUN_KEY(runId), JSON.stringify(run));
  // maintain index of recent runs
  try {
    const raw = await kvGet(RUN_ALL_KEY);
    let arr = [];
    if (raw) {
      try { arr = JSON.parse(raw) || []; } catch {};
    }
    arr = [runId, ...arr.filter((r) => r !== runId)];
    if (arr.length > MAX_RUNS) arr = arr.slice(0, MAX_RUNS);
    await kvSet(RUN_ALL_KEY, JSON.stringify(arr));
  } catch (e) {
    // non‑fatal
    console.error("error indexing run", e);
  }
  return run;
}

async function getRun(runId) {
  if (!runId) return null;
  const raw = await kvGet(RUN_KEY(runId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveRun(run) {
  if (!run || !run.runId) throw new Error("run object must include runId");
  await kvSet(RUN_KEY(run.runId), JSON.stringify(run));
  return run;
}

async function getNodeRun(runId, nodeId) {
  const raw = await kvGet(NODE_KEY(runId, nodeId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveNodeRun(runId, nodeRun) {
  if (!runId || !nodeRun || !nodeRun.nodeId) throw new Error("nodeRun must include runId and nodeId");
  await kvSet(NODE_KEY(runId, nodeRun.nodeId), JSON.stringify(nodeRun));
  return nodeRun;
}

module.exports = {
  listDefinitions,
  getDefinition,
  saveDefinition,
  createRun,
  getRun,
  saveRun,
  getNodeRun,
  saveNodeRun,
};
