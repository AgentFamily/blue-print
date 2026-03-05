const { getAccount } = require("./accounts");

// returns array of missing provider names (not connected)
async function checkConnections(providers) {
  if (!Array.isArray(providers) || providers.length === 0) return [];
  const missing = [];
  for (const name of providers) {
    const acct = await getAccount(name);
    if (!acct || acct.status !== "connected") missing.push(name);
  }
  return missing;
}

module.exports = { checkConnections };
