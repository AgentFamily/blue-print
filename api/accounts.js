const { listAccounts, getAccount } = require("./_lib/accounts");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }
  try {
    const providers = await listAccounts();
    const accounts = [];
    for (const p of providers) {
      const acct = await getAccount(p);
      if (acct) accounts.push(acct);
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(accounts));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message) }));
  }
};