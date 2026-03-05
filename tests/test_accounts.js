// simple node script to exercise account helpers
const { accounts } = require("../api/_lib");

async function run() {
  console.log("listing existing accounts:");
  console.log(await accounts.listAccounts());

  console.log("upsert dummy acct");
  await accounts.upsertAccount({
    provider: "testprov",
    status: "connected",
    connectedAt: Date.now(),
    scopes: ["scope1"],
    tokenRef: "vault:test",
    meta: { foo: "bar" },
  });
  console.log("list after insert:", await accounts.listAccounts());
  console.log("getAccount testprov", await accounts.getAccount("testprov"));
  console.log("disconnecting testprov");
  await accounts.disconnectAccount("testprov");
  console.log("final state", await accounts.getAccount("testprov"));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
