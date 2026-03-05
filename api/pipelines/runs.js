const { pipelines } = require("../_lib");
const { getRun } = pipelines;

// since Upstash KV doesn't support scanning by prefix easily in REST, we will
// rely on keeping an index of recent run IDs. For now, this implementation
// stores a simple list of the last N runs in a KV key `pipe:run:all`.

const RUN_ALL_KEY = "pipe:run:all";
const { kvGet, kvSet } = require("../_lib");

const MAX_LIST = 100;

async function addToRunList(runId) {
  const raw = await kvGet(RUN_ALL_KEY);
  let arr = [];
  if (raw) {
    try {
      arr = JSON.parse(raw) || [];
    } catch {}
  }
  arr = [runId, ...arr.filter((r) => r !== runId)];
  if (arr.length > MAX_LIST) arr = arr.slice(0, MAX_LIST);
  await kvSet(RUN_ALL_KEY, JSON.stringify(arr));
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }
  try {
    const raw = await kvGet(RUN_ALL_KEY);
    let ids = [];
    if (raw) {
      try { ids = JSON.parse(raw) || []; } catch {}
    }
    const runs = [];
    for (const id of ids) {
      const r = await getRun(id);
      if (r) runs.push(r);
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(runs));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};
