const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeSnapshotV1, stripSecretKeys } = require("../lib/blueprint/services/mail_ssot_schema");

test("stripSecretKeys removes secret-like fields recursively", () => {
  const out = stripSecretKeys({
    planId: "alpha",
    apiKey: "should-remove",
    nested: {
      password: "remove",
      ok: "keep",
    },
    list: [
      { token: "remove", value: 1 },
      { note: "keep" },
    ],
  });

  assert.equal(Object.prototype.hasOwnProperty.call(out, "apiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out.nested, "password"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out.list[0], "token"), false);
  assert.equal(out.nested.ok, "keep");
});

test("sanitizeSnapshotV1 returns contract shape with connector refs", () => {
  const snapshot = sanitizeSnapshotV1({
    schema: "agentc.mailssot.snapshot.v1",
    planId: "plan_marketing",
    revision: 2,
    capturedAt: "2026-03-05T09:10:00.000Z",
    connectorRefs: [
      {
        type: "blueprint_connection",
        workspaceId: "ws_core",
        connectorId: "mailbox",
        connectionId: "conn_000111",
        apiKey: "must-not-survive",
      },
    ],
    strategic: {
      draft: {
        objective: "Ship campaign",
        metric: "CPL down 20%",
        horizon: "30",
        constraints: "budget cap",
        plan: "phase 1...",
      },
      tasks: [
        {
          id: "t1",
          title: "Publish assets",
          owner: "me",
          due: "2026-03-30",
          done: false,
          createdAt: 1234,
          token: "secret-token-value",
        },
      ],
    },
    followups: {
      tasks: [
        {
          id: "f1",
          title: "Check ad spend",
          dueAt: "2026-03-06T10:00:00.000Z",
          status: "todo",
          priority: "high",
          notes: "watch burn rate",
          source: "strategic_workbench",
          createdAt: 1,
          updatedAt: 2,
          password: "do-not-keep",
        },
      ],
    },
    mailMemory: {
      userEmail: "user@example.com",
      botEmail: "bot@example.com",
      channel: "agentc-memory",
      events: [{ type: "memory", payload: "ok", secret: "remove" }],
    },
  });

  assert.equal(snapshot.schema, "agentc.mailssot.snapshot.v1");
  assert.equal(snapshot.planId, "plan_marketing");
  assert.equal(snapshot.connectorRefs.length, 1);
  assert.equal(snapshot.connectorRefs[0].connectorId, "mailbox");
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.connectorRefs[0], "apiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.strategic.tasks[0], "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.followups.tasks[0], "password"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.mailMemory.events[0], "secret"), false);
});
