process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb } = require("../lib/blueprint/db");
const {
  authorizeConnector,
  testConnector,
  getConnectorRequirements,
} = require("../lib/blueprint/services/connector_service");
const { getConnector } = require("../lib/blueprint/connectors/registry");

test("fasthosts connector requirements shape is available", () => {
  const reqs = getConnectorRequirements({ connectorId: "fasthosts" });
  assert.equal(reqs.id, "fasthosts");
  assert.equal(reqs.authType, "apiKey");
  assert.ok(Array.isArray(reqs.fields));
  assert.ok(reqs.fields.some((field) => field.name === "apiKey"));
});

test("fasthosts authorize + test succeeds for valid-looking key", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "fh_live_valid_mock_key_123456",
      scopes: ["domain:read", "dns:read"],
    },
  });

  assert.ok(authorized.connectionId);

  const result = await testConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
});

test("fasthosts test returns not-ok for invalid key format", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "short",
      scopes: ["domain:read"],
    },
  });

  const result = await testConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, false);
});

test("fasthosts dashboard mode exposes domain and email access payloads", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      accessMode: "dashboard",
      dashboardUrl: "https://admin.fasthosts.co.uk",
      webmailUrl: "https://webmail.fasthosts.co.uk",
      accountEmail: "ops@example.com",
      scopes: ["domain:read", "dns:read", "email:read", "dashboard:read"],
    },
  });

  const result = await testConnector({
    connectorId: "fasthosts",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "dashboard");
  assert.equal(result.access.dashboard.loginUrl, "https://admin.fasthosts.co.uk");
  assert.equal(result.access.email.webmailUrl, "https://webmail.fasthosts.co.uk");

  const connector = getConnector("fasthosts");
  const domainAccess = await connector.request(
    authorized.connectionId,
    {
      method: "POST",
      path: "/domains/access",
      body: { domain: "a-i-agency.com" },
    },
    {
      actorUserId: "usr_demo",
      workspaceId: "ws_core",
    }
  );
  assert.equal(domainAccess.ok, true);
  assert.equal(domainAccess.data.domain, "a-i-agency.com");
  assert.equal(domainAccess.data.dashboardLoginUrl, "https://admin.fasthosts.co.uk");

  const emailAccess = await connector.request(
    authorized.connectionId,
    {
      method: "POST",
      path: "/emails/access",
      body: {},
    },
    {
      actorUserId: "usr_demo",
      workspaceId: "ws_core",
    }
  );
  assert.equal(emailAccess.ok, true);
  assert.equal(emailAccess.data.mailboxesAccessible, true);
  assert.equal(emailAccess.data.webmailUrl, "https://webmail.fasthosts.co.uk");
});

test("openai connector authorize + test succeeds", async () => {
  resetBlueprintDb();

  const authorized = await authorizeConnector({
    connectorId: "openai",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      apiKey: "sk-test-openai-key-1234567890",
      organization: "org_blueprint",
      scopes: ["responses:write", "models:read"],
    },
  });

  const result = await testConnector({
    connectorId: "openai",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });

  assert.equal(result.ok, true);
});
