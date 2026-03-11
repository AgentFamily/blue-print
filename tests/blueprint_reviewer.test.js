process.env.KEYRING = process.env.KEYRING || "blueprint-test-keyring-32-plus-characters";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resetBlueprintDb, createServerActionPlan } = require("../lib/blueprint/db");
const {
  assessExecutionRequest,
  recordReviewerOutcome,
} = require("../lib/blueprint/services/reviewer_service");

test("reviewer clears low-risk read tasks", () => {
  resetBlueprintDb();
  const review = assessExecutionRequest({
    workspaceId: "ws_core",
    prompt: "Read the logs and summarize the issue.",
    taskContext: { kind: "read" },
  });
  assert.equal(review.status, "clear");
  assert.equal(review.allowAutoExecute, true);
});

test("reviewer blocks duplicate action fingerprints", () => {
  resetBlueprintDb();
  const first = assessExecutionRequest({
    workspaceId: "ws_core",
    prompt: "Send the same email update to the client.",
    taskContext: { kind: "email" },
  });
  recordReviewerOutcome({
    workspaceId: "ws_core",
    createdBy: "system",
    reviewer: first,
    prompt: "Send the same email update to the client.",
    taskContext: { kind: "email" },
  });

  const second = assessExecutionRequest({
    workspaceId: "ws_core",
    prompt: "Send the same email update to the client.",
    taskContext: { kind: "email" },
  });
  assert.equal(second.status, "blocked_conflict");
  assert.equal(second.conflicts.some((item) => item.type === "duplicate_action"), true);
});

test("reviewer detects conflicting server changes", () => {
  resetBlueprintDb();
  createServerActionPlan({
    workspaceId: "ws_core",
    actionId: "open_access_15m",
    section: "access",
    status: "pending_external",
    indicator: "amber",
    params: {},
    reviewer: {},
    createdBy: "system",
  });

  const review = assessExecutionRequest({
    workspaceId: "ws_core",
    prompt: "Lock server immediately.",
    taskContext: {
      actionArea: "server",
      actionId: "lock_server",
    },
    intents: ["server_action"],
  });

  assert.equal(review.status, "blocked_conflict");
  assert.equal(review.conflicts.some((item) => item.type === "conflicting_server_change"), true);
});
