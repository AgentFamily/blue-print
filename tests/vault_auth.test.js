const test = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = require.resolve("../lib/vault_auth");

const loadVaultAuth = () => {
  delete require.cache[MODULE_PATH];
  return require("../lib/vault_auth");
};

const makeRes = () => {
  const state = {
    statusCode: 200,
    headers: {},
    body: "",
  };
  return {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value) {
      state.statusCode = value;
    },
    setHeader(name, value) {
      state.headers[String(name || "").toLowerCase()] = value;
    },
    end(value) {
      state.body = String(value || "");
    },
    snapshot() {
      return { ...state };
    },
  };
};

const withVaultEnv = (env, fn) => {
  const previousMk = process.env.MK_VAULT_PASSWORD;
  const previousLegacy = process.env.VAULT_PANEL_PASSWORD;
  if (env.mk === undefined) delete process.env.MK_VAULT_PASSWORD;
  else process.env.MK_VAULT_PASSWORD = env.mk;
  if (env.legacy === undefined) delete process.env.VAULT_PANEL_PASSWORD;
  else process.env.VAULT_PANEL_PASSWORD = env.legacy;
  try {
    fn();
  } finally {
    if (previousMk === undefined) delete process.env.MK_VAULT_PASSWORD;
    else process.env.MK_VAULT_PASSWORD = previousMk;
    if (previousLegacy === undefined) delete process.env.VAULT_PANEL_PASSWORD;
    else process.env.VAULT_PANEL_PASSWORD = previousLegacy;
    delete require.cache[MODULE_PATH];
  }
};

test("MK_VAULT_PASSWORD authenticates vault requests", () => {
  withVaultEnv({ mk: "mk-secret-123", legacy: undefined }, () => {
    const { requireVaultPassword } = loadVaultAuth();
    const res = makeRes();
    const allowed = requireVaultPassword(
      { headers: { "x-agentc-vault-pass": "mk-secret-123" } },
      res
    );

    assert.equal(allowed, true);
    assert.equal(res.snapshot().statusCode, 200);
  });
});

test("MK_VAULT_PASSWORD takes precedence over legacy VAULT_PANEL_PASSWORD", () => {
  withVaultEnv({ mk: "mk-secret-123", legacy: "legacy-secret-999" }, () => {
    const { requireVaultPassword, expectedVaultPassword } = loadVaultAuth();
    assert.equal(expectedVaultPassword(), "mk-secret-123");

    const rejectedRes = makeRes();
    const rejected = requireVaultPassword(
      { headers: { "x-agentc-vault-pass": "legacy-secret-999" } },
      rejectedRes
    );
    assert.equal(rejected, false);
    assert.equal(rejectedRes.snapshot().statusCode, 401);

    const acceptedRes = makeRes();
    const accepted = requireVaultPassword(
      { headers: { "x-agentc-vault-pass": "mk-secret-123" } },
      acceptedRes
    );
    assert.equal(accepted, true);
  });
});

test("vault auth keeps legacy fallback when no env is configured", () => {
  withVaultEnv({ mk: undefined, legacy: undefined }, () => {
    const { requireVaultPassword, expectedVaultPassword } = loadVaultAuth();
    assert.equal(expectedVaultPassword(), "ThisisnotMK");

    const res = makeRes();
    const allowed = requireVaultPassword(
      { headers: { "x-agentc-vault-pass": "ThisisnotMK" } },
      res
    );
    assert.equal(allowed, true);
  });
});
