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

const { listDefinitions, getDefinition, saveDefinition } = require("./_lib/pipelines");

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      let ids = await listDefinitions();
      // if no definitions yet, create a simple example template for testing
      if (!ids || ids.length === 0) {
        const sample = {
          id: "lead-to-invoice",
          name: "Lead → Invoice",
          version: 1,
          nodes: [
            { id: "intake", type: "intake", next: ["qualify"] },
            { id: "qualify", type: "qualifier", next: ["crmSync"] },
            { id: "crmSync", type: "crm_sync", next: ["schedule"] },
          ],
        };
        await saveDefinition(sample);
        ids = [sample.id];
      }
      const defs = [];
      for (const id of ids) {
        const d = await getDefinition(id);
        if (d) defs.push(d);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(defs));
    } catch (err) {
      res.statusCode = err.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err.message) }));
    }
    return;
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body || !body.id) {
      res.statusCode = 400;
      res.end("pipeline definition must include id");
      return;
    }
    try {
      const saved = await saveDefinition(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(saved));
    } catch (err) {
      res.statusCode = err.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(err.message) }));
    }
    return;
  }

  res.statusCode = 405;
  res.setHeader("Allow", "GET, POST");
  res.end("Method Not Allowed");
};