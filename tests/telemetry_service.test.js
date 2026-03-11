const path = require("path");

process.env.BLUEPRINT_TELEMETRY_FILE = path.join(
  __dirname,
  "..",
  "tmp",
  "blueprint-telemetry-tests",
  "telemetry-service.jsonl"
);

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TELEMETRY_FILE,
  recordTelemetryEvent,
  readTelemetryEvents,
  resetTelemetryStore,
} = require("../lib/blueprint/services/telemetry_service");

test("telemetry service appends normalized verified events to the local store", () => {
  resetTelemetryStore();

  const stored = recordTelemetryEvent({
    eventType: "task.lifecycle",
    source: "toolbox_client",
    taskId: "task_alpha",
    outcome: "completed",
    meta: {
      nested: {
        ok: true,
      },
    },
  });

  assert.ok(TELEMETRY_FILE.endsWith("/tmp/blueprint-telemetry-tests/telemetry-service.jsonl"));
  assert.equal(stored.eventType, "task.lifecycle");
  assert.equal(stored.verified, true);

  const events = readTelemetryEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].taskId, "task_alpha");
  assert.equal(events[0].outcome, "completed");
  assert.deepEqual(events[0].meta, {
    nested: {
      ok: true,
    },
  });
});
