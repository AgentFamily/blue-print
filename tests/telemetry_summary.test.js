const path = require("path");

process.env.BLUEPRINT_TELEMETRY_FILE = path.join(
  __dirname,
  "..",
  "tmp",
  "blueprint-telemetry-tests",
  "telemetry-summary.jsonl"
);

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recordTelemetryEvents,
  computeTelemetrySummary,
  resetTelemetryStore,
} = require("../lib/blueprint/services/telemetry_service");

test("telemetry summary reports insufficient data when no verified samples exist", () => {
  resetTelemetryStore();

  const summary = computeTelemetrySummary({ hours: 24 });
  assert.equal(summary.api.status, "insufficient_data");
  assert.equal(summary.routes.status, "insufficient_data");
  assert.equal(summary.tasks.status, "insufficient_data");
  assert.equal(summary.widgets.status, "insufficient_data");
  assert.equal(summary.routes.successRate, null);
  assert.equal(summary.tasks.completionRate, null);
});

test("telemetry summary derives KPI, route, and completion metrics from stored events", () => {
  resetTelemetryStore();

  recordTelemetryEvents([
    {
      eventType: "api.request",
      routeId: "api.widgets.run",
      method: "POST",
      httpStatus: 200,
    },
    {
      eventType: "api.request",
      routeId: "api.workspaces",
      method: "GET",
      httpStatus: 200,
    },
    {
      eventType: "route.execution",
      routeId: "route.alpha",
      routeRunId: "run_alpha",
      outcome: "start",
    },
    {
      eventType: "route.execution",
      routeId: "route.alpha",
      routeRunId: "run_alpha",
      outcome: "success",
    },
    {
      eventType: "route.execution",
      routeId: "route.beta",
      routeRunId: "run_beta",
      outcome: "start",
    },
    {
      eventType: "route.execution",
      routeId: "route.beta",
      routeRunId: "run_beta",
      outcome: "fallback",
    },
    {
      eventType: "route.execution",
      routeId: "route.beta",
      routeRunId: "run_beta",
      outcome: "recovery",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_a",
      outcome: "queued",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_a",
      outcome: "completed",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_b",
      outcome: "queued",
    },
    {
      eventType: "task.lifecycle",
      taskId: "task_b",
      outcome: "escalated",
    },
    {
      eventType: "widget.visibility",
      widgetId: "chat_assistant",
      outcome: "visible",
    },
    {
      eventType: "widget.use",
      widgetId: "chat_assistant",
      outcome: "used",
    },
  ]);

  const summary = computeTelemetrySummary({ hours: 24 });

  assert.equal(summary.api.status, "verified");
  assert.equal(summary.api.requestCount, 2);
  assert.equal(summary.routes.status, "verified");
  assert.equal(summary.routes.counts.start, 2);
  assert.equal(summary.routes.counts.success, 1);
  assert.equal(summary.routes.counts.fallback, 1);
  assert.equal(summary.routes.counts.recovery, 1);
  assert.equal(summary.routes.successRate, 50);
  assert.equal(summary.routes.fallbackRate, 50);
  assert.equal(summary.routes.recoveryRate, 100);
  assert.equal(summary.tasks.status, "verified");
  assert.equal(summary.tasks.terminalCount, 2);
  assert.equal(summary.tasks.completionRate, 50);
  assert.equal(summary.tasks.escalationRate, 50);
  assert.equal(summary.widgets.status, "verified");
  assert.equal(summary.widgets.visibleCount, 1);
  assert.equal(summary.widgets.useCount, 1);
});
