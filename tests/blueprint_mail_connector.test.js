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

test("mailbox connector requirements shape is available", () => {
  const reqs = getConnectorRequirements({ connectorId: "mailbox" });
  assert.equal(reqs.id, "mailbox");
  assert.equal(reqs.authType, "apiKey");
  assert.ok(Array.isArray(reqs.fields));
  assert.ok(reqs.fields.some((field) => field.name === "mailboxEmail"));
  assert.ok(reqs.fields.some((field) => field.name === "apiKey"));
});

test("mailbox connector authorize + test succeeds", async () => {
  resetBlueprintDb();
  const authorized = await authorizeConnector({
    connectorId: "mailbox",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      mailboxEmail: "memory-bot@blueprint.ai",
      apiKey: "mailbox_live_key_123456789",
      scopes: ["mail:send", "mail:read"],
    },
  });
  assert.ok(authorized.connectionId);

  const result = await testConnector({
    connectorId: "mailbox",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    connectionId: authorized.connectionId,
  });
  assert.equal(result.ok, true);
});

test("mailbox connector enforces self-sent semantics and returns latest snapshot", async () => {
  resetBlueprintDb();
  const authorized = await authorizeConnector({
    connectorId: "mailbox",
    actorUserId: "usr_demo",
    workspaceId: "ws_core",
    input: {
      mailboxEmail: "self-memory@blueprint.ai",
      apiKey: "mailbox_live_key_abcdef12345",
    },
  });
  const connector = getConnector("mailbox");

  await assert.rejects(
    () =>
      connector.request(
        authorized.connectionId,
        {
          method: "POST",
          path: "/mail/ssot/save",
          body: {
            planId: "plan_alpha",
            from: "intruder@blueprint.ai",
            to: "self-memory@blueprint.ai",
            mailBody: "AGENTC_MAILSSOT_V1\ne30=",
          },
        },
        { actorUserId: "usr_demo", workspaceId: "ws_core" }
      ),
    /self-sent/
  );

  const saved = await connector.request(
    authorized.connectionId,
    {
      method: "POST",
      path: "/mail/ssot/save",
      body: {
        planId: "plan_alpha",
        mailBody: "AGENTC_MAILSSOT_V1\ne30=",
        subject: "AGENTC MailSSOT plan_alpha r1",
      },
    },
    { actorUserId: "usr_demo", workspaceId: "ws_core" }
  );
  assert.equal(saved.ok, true);
  assert.ok(saved.messageId);
  assert.equal(saved.from, "self-memory@blueprint.ai");
  assert.equal(saved.to, "self-memory@blueprint.ai");

  const latest = await connector.request(
    authorized.connectionId,
    {
      method: "GET",
      path: "/mail/ssot/latest",
      body: {
        planId: "plan_alpha",
      },
    },
    { actorUserId: "usr_demo", workspaceId: "ws_core" }
  );
  assert.equal(latest.ok, true);
  assert.equal(latest.found, true);
  assert.equal(latest.from, "self-memory@blueprint.ai");
  assert.equal(latest.to, "self-memory@blueprint.ai");
});
