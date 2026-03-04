process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb, listAudits } = require("../lib/blueprint/db");
const {
  createSecret,
  listSecretMetadata,
  readSecretPlaintextForServer,
} = require("../lib/blueprint/vault/service");

test("vault encrypts secrets and only exposes plaintext once", () => {
  resetBlueprintDb();

  const created = createSecret({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "fasthosts",
    name: "fasthosts_api_key",
    value: "fh_live_test_secret_001",
  });

  assert.equal(created.plaintextOnce, "fh_live_test_secret_001");
  const listed = listSecretMetadata({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "fasthosts",
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].maskedValue, "***");
  assert.equal(Object.prototype.hasOwnProperty.call(listed[0], "plaintextOnce"), false);

  const plain = readSecretPlaintextForServer({
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectorId: "fasthosts",
    name: "fasthosts_api_key",
  });
  assert.equal(plain, "fh_live_test_secret_001");

  const audits = listAudits().filter((row) => row.targetType === "vault_secret");
  assert.ok(audits.some((row) => row.action === "vault.secret.create"));
  assert.ok(audits.some((row) => row.action === "vault.secret.use"));
});
