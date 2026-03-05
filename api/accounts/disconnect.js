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

const { accounts } = require("../_lib");
const { disconnectAccount } = accounts;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !body.provider) {
    res.statusCode = 400;
    res.end("Missing provider in request body");
    return;
  }

  try {
    const result = await disconnectAccount(body.provider);
    if (!result) {
      res.statusCode = 404;
      res.end("Provider not found");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};